// La URL sale de API_URL al compilar (scripts/generar-api-url.js).
import { API_URL } from './api-url';

export const environment = {
  production: false,
  apiUrl: API_URL
};
