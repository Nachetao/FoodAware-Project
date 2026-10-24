// Variables de entorno de la suite de integración. Se cargan antes de importar
// la app: algunos módulos las leen al importarse (por ejemplo, LOG_LEVEL).
// process.env tiene prioridad sobre el ../.env que carga ConfigModule.
process.env.LOG_LEVEL = "silent";
process.env.JWT_SECRET = "secreto-de-integracion";
// Timeout corto para que los casos de FastAPI colgado no alarguen la suite.
process.env.PYTHON_API_TIMEOUT_MS = "300";
process.env.PYTHON_API_REINTENTOS = "2";
