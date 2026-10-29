import { config } from './config.js';
import { createApp } from './http/app.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
