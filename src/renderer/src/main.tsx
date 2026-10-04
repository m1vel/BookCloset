import { createRoot } from 'react-dom/client'
import './styles/fonts'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/covers.css'
import './styles/library.css'
import './styles/reader.css'
import './styles/pages.css'
import './styles/stats.css'
import './styles/settings.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
