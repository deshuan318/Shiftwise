// /api/square-sync.js
// Pulls completed orders from Square and writes two views of the same sales:
//  - sales_data:   daily totals (same table the CSV import and cash entry use)
//  - sales_hourly: the same revenue broken out by local hour, which lets
//                  ShiftWise credit real sales to the shifts that covered them.
// The hourly rows always sum back to the daily row for that date.
//  - sales_items_daily: per-item units and sales per day — the outcome side
//                  of price-change tracking.
//  - catalog_price_history: each item's SET price from the Square catalog.
//                  The only source for price changes, so POS overrides (even
//                  several days in a row) are never treated as a change.
//  Both are fully separate: if either step fails, the sync still succeeds
//  and nothing else in the app is affected.
//
// Sync strategy:
//  - First-ever sync (no last_synced_at on file): full historical backfill,
//    capped at FULL_BACKFILL_DAYS so a long-lived Square account doesn't
//    cause a single sync to run forever.
//  - Every sync after that: incremental — only pull orders closed since the
//    last sync, with a small overlap window to catch anything that closed
//    late or was edited after the fact.

export const config = { maxDuration: 60 };

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL   = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARE_VERSION = "2024-01-18";
const FULL_BACKFILL_DAYS     = 1095; // ~3 years, first sync only
const INCREMENTAL_OVERLAP_DAYS = 3;  // re-check a small buffer on repeat syncs

async function refreshAccessToken(conn) {
  const r = await fetch(`${SQUARE_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Token refresh failed");

  await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${conn.business_id}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at || null,
    }),
  });

  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: "Missing business_id" });
  }

  try {
    // 1. Load the connection
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}&select=*`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );
    const conns = await connRes.json();
    const conn = conns?.[0];
    if (!conn) return res.status(404).json({ error: "Square is not connected for this business" });

    let accessToken = conn.access_token;

    // 2. Refresh if expired or expiring within the hour
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date(Date.now() + 60 * 60 * 1000)) {
      accessToken = await refreshAccessToken(conn);
    }

    // 3. Find this merchant's active locations
    const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const locData = await locRes.json();
    if (!locRes.ok) {
      console.error("Square locations fetch failed:", locData);
      throw new Error(locData?.errors?.[0]?.detail || "Square locations fetch failed");
    }
    const activeLocations = (locData.locations || []).filter(l => l.status === "ACTIVE");
    const locationIds = activeLocations.map(l => l.id);
    if (locationIds.length === 0) {
      throw new Error("No active Square locations found for this account");
    }
    // Use the first active location's timezone for bucketing order dates.
    // Falls back to Central Time if Square doesn't report one.
    const timeZone = activeLocations[0]?.timezone || "America/Chicago";
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const hourFormatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" });
    const localHour = d => parseInt(hourFormatter.formatToParts(d).find(p => p.type === "hour").value, 10) % 24;

    // 4. Pull completed orders for the lookback window (paginated)
    let startAt;
    let syncType;
    // Item-level history: the first sync after item tracking ships pulls the
    // full history once (like a first-ever sync), so item reports work right
    // away. Daily and hourly totals are rewritten with the same numbers.
    const needItemBackfill = !conn.items_backfilled_at;
    if (conn.last_synced_at && !needItemBackfill) {
      const since = new Date(conn.last_synced_at);
      since.setUTCDate(since.getUTCDate() - INCREMENTAL_OVERLAP_DAYS);
      startAt = since.toISOString();
      syncType = "incremental";
    } else {
      startAt = new Date(Date.now() - FULL_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      syncType = "full_backfill";
    }
    let orders = [];
    let cursor = null;

    do {
      const body = {
        location_ids: locationIds,
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: { closed_at: { start_at: startAt } },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
        limit: 500,
      };
      if (cursor) body.cursor = cursor;

      const ordersRes = await fetch(`${SQUARE_BASE}/v2/orders/search`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
        },
        body: JSON.stringify(body),
      });
      const ordersData = await ordersRes.json();
      if (!ordersRes.ok) {
        console.error("Square orders/search failed:", ordersData);
        throw new Error(ordersData?.errors?.[0]?.detail || "Square orders fetch failed");
      }

      orders = orders.concat(ordersData.orders || []);
      cursor = ordersData.cursor || null;
    } while (cursor);

    // 5. Aggregate to daily AND hourly revenue (location's local time, not UTC)
    //
    // An incremental window starts mid-day (e.g. 2:14pm three days ago), so
    // that first date only contains the orders after that moment. Upserting
    // it would overwrite that day's full total with a partial one. That day
    // was fully captured by an earlier sync, so it's skipped here.
    const partialFirstDate = syncType === "incremental" ? dayFormatter.format(new Date(startAt)) : null;
    const dayTotals = {};
    const hourTotals = {}; // "YYYY-MM-DD|H" -> { revenue, transactions }
    const itemTotals = {}; // "YYYY-MM-DD|itemKey" -> { name, qty, revenue, prices: {cents: qty} }
    for (const order of orders) {
      const ts = order.closed_at || order.created_at;
      if (!ts) continue;
      const when = new Date(ts);
      const date = dayFormatter.format(when); // YYYY-MM-DD in location's timezone
      if (date === partialFirstDate) continue;
      const hour = localHour(when);
      const amount = (order.total_money?.amount || 0) / 100;
      if (!dayTotals[date]) dayTotals[date] = { revenue: 0, transactions: 0 };
      dayTotals[date].revenue += amount;
      dayTotals[date].transactions += 1;
      const hk = `${date}|${hour}`;
      if (!hourTotals[hk]) hourTotals[hk] = { revenue: 0, transactions: 0 };
      hourTotals[hk].revenue += amount;
      hourTotals[hk].transactions += 1;

      // Catalog items only — custom amounts have no fixed price to track
      for (const li of order.line_items || []) {
        if (!li.catalog_object_id) continue;
        const qty = parseFloat(li.quantity) || 0;
        if (qty <= 0) continue;
        const ik = `${date}|${li.catalog_object_id}`;
        const name = [li.name, li.variation_name && li.variation_name !== "Regular" ? li.variation_name : null].filter(Boolean).join(" · ") || "Item";
        if (!itemTotals[ik]) itemTotals[ik] = { name, qty: 0, revenue: 0, prices: {} };
        const it = itemTotals[ik];
        it.qty += qty;
        it.revenue += (li.gross_sales_money?.amount || 0) / 100;
        const cents = li.base_price_money?.amount;
        if (cents != null) it.prices[cents] = (it.prices[cents] || 0) + qty;
      }
    }

    const salesData = Object.entries(dayTotals)
      .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, transactions: d.transactions }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 6. Upsert into sales_data
    if (salesData.length > 0) {
      const rows = salesData.map(d => ({
        business_id, sale_date: d.date, revenue: d.revenue, transactions: d.transactions, source: "square",
      }));
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/sales_data?on_conflict=business_id,sale_date,source`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        console.error("sales_data upsert failed:", errText);
        throw new Error("Could not save synced sales data");
      }
    }

    // 6b. Upsert hourly breakdown into sales_hourly (chunked — a first-time
    // 3-year backfill can produce tens of thousands of hourly rows)
    const hourlyRows = Object.entries(hourTotals).map(([hk, h]) => {
      const [date, hour] = hk.split("|");
      return {
        business_id, sale_date: date, hour: parseInt(hour, 10),
        revenue: Math.round(h.revenue * 100) / 100, transactions: h.transactions,
      };
    });
    const HOURLY_CHUNK = 1000;
    for (let i = 0; i < hourlyRows.length; i += HOURLY_CHUNK) {
      const hourlyRes = await fetch(`${SUPABASE_URL}/rest/v1/sales_hourly?on_conflict=business_id,sale_date,hour`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(hourlyRows.slice(i, i + HOURLY_CHUNK)),
      });
      if (!hourlyRes.ok) {
        const errText = await hourlyRes.text();
        console.error("sales_hourly upsert failed:", errText);
        throw new Error("Could not save hourly sales data");
      }
    }

    // 6c. Item-level daily sales (price-change detection only). Isolated:
    // a failure here is logged and reported, never fails the sync.
    let itemsSynced = 0, itemsWarning = null;
    try {
      const itemRows = Object.entries(itemTotals).map(([ik, it]) => {
        const [date, itemKey] = ik.split("|");
        // Regular price for the day = the price most units sold at
        const top = Object.entries(it.prices).sort((a, b) => b[1] - a[1])[0];
        return {
          business_id, sale_date: date, item_key: itemKey, item_name: it.name,
          quantity: Math.round(it.qty * 100) / 100,
          revenue: Math.round(it.revenue * 100) / 100,
          unit_price: top ? Number(top[0]) / 100 : null,
        };
      });
      const ITEM_CHUNK = 1000;
      for (let i = 0; i < itemRows.length; i += ITEM_CHUNK) {
        const itemRes = await fetch(`${SUPABASE_URL}/rest/v1/sales_items_daily?on_conflict=business_id,sale_date,item_key`, {
          method: "POST",
          headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(itemRows.slice(i, i + ITEM_CHUNK)),
        });
        if (!itemRes.ok) throw new Error(await itemRes.text());
        itemsSynced += Math.min(ITEM_CHUNK, itemRows.length - i);
      }
    } catch (itemErr) {
      console.warn("sales_items_daily upsert failed (sync continues):", itemErr);
      itemsWarning = "Item-level sales didn't save; daily and hourly sales are fine.";
    }

    // 6d. Catalog prices. Needs the ITEMS_READ scope — accounts connected
    // before it was added get a "reconnect Square" warning, nothing breaks.
    let pricesWarning = null, priceChangesFound = 0;
    try {
      const todayLocal = dayFormatter.format(new Date());
      const primaryLoc = locationIds[0];
      const current = [];
      let catCursor = null;
      do {
        const catUrl = `${SQUARE_BASE}/v2/catalog/list?types=ITEM${catCursor ? `&cursor=${encodeURIComponent(catCursor)}` : ""}`;
        const cr = await fetch(catUrl, { headers: { "Authorization": `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION } });
        const cd = await cr.json();
        if (!cr.ok) {
          const err = new Error(cd?.errors?.[0]?.detail || "Catalog fetch failed");
          err.status = cr.status; err.code = cd?.errors?.[0]?.code;
          throw err;
        }
        for (const obj of cd.objects || []) {
          if (obj.is_deleted) continue;
          const itemName = obj.item_data?.name || "Item";
          for (const v of obj.item_data?.variations || []) {
            if (v.is_deleted) continue;
            const vd = v.item_variation_data || {};
            if (vd.pricing_type && vd.pricing_type !== "FIXED_PRICING") continue; // variable-price items have no set price
            const ov = (vd.location_overrides || []).find(o => o.location_id === primaryLoc && o.price_money);
            const cents = ov?.price_money?.amount ?? vd.price_money?.amount;
            if (cents == null) continue;
            current.push({
              item_key: v.id,
              item_name: [itemName, vd.name && vd.name !== "Regular" ? vd.name : null].filter(Boolean).join(" · "),
              price: Number(cents) / 100,
              updated_at: v.updated_at || obj.updated_at || null,
            });
          }
        }
        catCursor = cd.cursor || null;
      } while (catCursor);

      const histRes = await fetch(`${SUPABASE_URL}/rest/v1/catalog_price_history?select=item_key,price,effective_date&business_id=eq.${business_id}&order=effective_date.desc&limit=20000`, {
        headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
      });
      if (!histRes.ok) throw new Error(await histRes.text());
      const latest = {};
      (await histRes.json()).forEach(r => { if (!latest[r.item_key]) latest[r.item_key] = r; });

      const priceRows = [];
      for (const c of current) {
        const prev = latest[c.item_key];
        if (!prev) {
          // First time we see this item: record its current price as the starting point
          priceRows.push({ business_id, item_key: c.item_key, item_name: c.item_name, price: c.price, effective_date: todayLocal, is_baseline: true });
          continue;
        }
        if (Math.abs(Number(prev.price) - c.price) < 0.005) continue;
        // Date the change by when the item was edited in Square
        let eff = c.updated_at ? dayFormatter.format(new Date(c.updated_at)) : todayLocal;
        if (eff < prev.effective_date) eff = prev.effective_date;
        priceRows.push({ business_id, item_key: c.item_key, item_name: c.item_name, price: c.price, effective_date: eff, is_baseline: false });
        priceChangesFound++;
      }
      for (let i = 0; i < priceRows.length; i += 1000) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/catalog_price_history?on_conflict=business_id,item_key,effective_date`, {
          method: "POST",
          headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(priceRows.slice(i, i + 1000)),
        });
        if (!pr.ok) throw new Error(await pr.text());
      }
    } catch (priceErr) {
      console.warn("Catalog price tracking failed (sync continues):", priceErr);
      pricesWarning = (priceErr.status === 401 || priceErr.status === 403 || /scope|permission|forbidden|unauthorized/i.test(`${priceErr.code || ""} ${priceErr.message || ""}`))
        ? "Reconnect Square to turn on price-change tracking (it needs access to your item catalog)."
        : "Price tracking didn't update this sync; your sales data is fine.";
    }

    // 6e. Mark the item history as backfilled (separate call: if the column
    // isn't there yet, this fails quietly and never blocks the sync time below)
    if (needItemBackfill && !itemsWarning) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}`, {
          method: "PATCH",
          headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ items_backfilled_at: new Date().toISOString() }),
        });
      } catch (flagErr) { console.warn("items_backfilled_at update failed:", flagErr); }
    }

    // 7. Record sync time
    const now = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}`, {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ last_synced_at: now }),
    });

    return res.status(200).json({ salesData, daysSynced: salesData.length, hoursSynced: hourlyRows.length, itemsSynced, itemsWarning, priceChangesFound, pricesWarning, lastSyncedAt: now, syncType, since: startAt, timeZone });
  } catch (err) {
    console.error("square-sync error:", err);
    return res.status(500).json({ error: err.message });
  }
}
