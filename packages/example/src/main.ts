import { defineCustomElement } from 'vue'
import App from './App.vue'

const cE = defineCustomElement(App)
customElements.define('foo-bar', cE)
