const app = require('./app');
const { port, jwt } = require('./config/env');

if (!jwt.secret) {
  console.error('JWT_SECRET не задан в .env');
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Cargo API запущен на порту ${port}`);
});
