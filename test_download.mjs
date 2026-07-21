import { downloadVideo } from './server/downloader.js';

try {
  const result = await downloadVideo('https://www.youtube.com/watch?v=aOZ5A9r_sAw', (pct) => console.log('Progress:', pct + '%'));
  console.log('Success:', result);
} catch(e) {
  console.error('Error:', (e).message);
}