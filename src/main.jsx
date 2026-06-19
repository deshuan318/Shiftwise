import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ShiftWiseKiosk from './ShiftWiseKiosk.jsx'
import './index.css'

// Simple path-based routing — no router library needed.
// Visiting /kiosk loads the standalone employee clock-in screen.
// Everything else loads the main owner app.
const isKioskRoute = window.location.pathname.startsWith('/kiosk')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isKioskRoute ? <ShiftWiseKiosk /> : <App />}
  </React.StrictMode>,
)
