import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initI18n } from '@/i18n'

initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
})
