import { createApp } from 'vue'
import App from './App.vue'
import './assets/bootstrap/bootstrap-tooltip.css'

const app = createApp(App)
const bootstrapScript = document.createElement('script')
bootstrapScript.src = new URL('./assets/bootstrap/bootstrap.bundle.min.js', import.meta.url).href
bootstrapScript.onload = () => app.mount('#app')
bootstrapScript.onerror = () => app.mount('#app')
document.head.appendChild(bootstrapScript)
