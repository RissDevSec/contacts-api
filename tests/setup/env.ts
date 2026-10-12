// Runs before every test file (unit + integration), before any app module loads.
// Values already present in the environment (CI, shell) always win.
process.env.NODE_ENV = "test";
process.env.SECRET_KEY ??= "test-secret-key";
process.env.SECRET_KEY_DATABASE ??= "test-secret-key-database";
process.env.SECRET_KEY_COOKIE ??= "test-secret-key-cookie";
process.env.REDIS_URL ??= "redis://localhost:6379/1";
