import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { installTracker } from '@/lib/track'
import { installViewportHeight } from '@/lib/viewport'
import './index.css'

installViewportHeight()
installTracker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
