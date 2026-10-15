module.exports = {
  enabled: process.env.DB_ENABLED === "true",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectString: process.env.DB_CONNECT_STRING || "localhost:1521/xe",
  poolMin: Number(process.env.DB_POOL_MIN || 1),
  poolMax: Number(process.env.DB_POOL_MAX || 5),
  poolIncrement: Number(process.env.DB_POOL_INCREMENT || 1),
  poolTimeout: Number(process.env.DB_POOL_TIMEOUT || 60)
};
