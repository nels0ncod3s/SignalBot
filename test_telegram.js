const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

async function testTelegram() {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  console.log('Using token:', config.telegramBotToken.slice(0, 10) + '...');
  console.log('Using chat ID:', config.telegramChatId);
  console.log('Sending test message...\n');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: '✅ Test message from your BTC paper trade bot. If you see this, the connection works!',
      }),
    });

    const data = await res.json();

    if (data.ok) {
      console.log('SUCCESS — message sent. Check Telegram now.');
    } else {
      console.log('FAILED — Telegram API returned an error:');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.log('FAILED — network or request error:');
    console.log(err.message);
  }
}

testTelegram();