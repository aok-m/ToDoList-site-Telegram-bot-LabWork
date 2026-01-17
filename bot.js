const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

let sessions = {};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Привет! Напиши /login для входа.');
});

bot.onText(/\/login/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Введите логин:');
  sessions[msg.chat.id] = { stage: 'awaiting_username' };
});

bot.onText(/\/logout/, (msg) => {
  if (sessions[msg.chat.id]) {
    delete sessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, 'Вы вышли из аккаунта. Чтобы войти снова, напишите /login.');
  } else {
    bot.sendMessage(msg.chat.id, 'Вы не вошли в аккаунт.');
  }
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];

  if (!session || session.stage !== 'logged_in') {
    bot.sendMessage(chatId, 'Сначала войдите в аккаунт с помощью /login');
    return;
  }

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [items] = await connection.execute(
      'SELECT id, text FROM items WHERE user_id = ?',
      [session.user_id]
    );
    await connection.end();

    if (items.length === 0) {
      bot.sendMessage(chatId, 'У вас пока нет задач.');
      return;
    }

    let reply = 'Ваш список дел:\n';
    items.forEach((task, index) => {
      reply += `${index + 1}. ${task.text}\n`;
    });
    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, 'Ошибка при получении списка дел.');
  }
});

bot.onText(/\/remind/, (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];

  if (!session || session.stage !== 'logged_in') {
    bot.sendMessage(chatId, 'Сначала войдите в аккаунт с помощью /login');
    return;
  }

  bot.sendMessage(chatId, 'Отправьте данные для напоминания в формате: номер_дела ДД.ММ.ГГГГ ЧЧ:ММ\nНапример: 1 21.06.2025 23:30');
  session.stage = 'awaiting_remind_details';
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];

  if (!session || msg.text.startsWith('/')) return;

  if (session.stage === 'awaiting_username') {
    session.username = msg.text.trim();
    session.stage = 'awaiting_password';
    bot.sendMessage(chatId, 'Теперь введите пароль:');
  } else if (session.stage === 'awaiting_password') {
    try {
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute(
        'SELECT id FROM users WHERE username = ? AND password = ?',
        [session.username.trim(), msg.text.trim()]
      );

      if (rows.length === 1) {
        session.stage = 'logged_in';
        session.user_id = rows[0].id;

       // Обнуляем telegram_id у других пользователей с таким же telegram_id
        await connection.execute(
          'UPDATE users SET telegram_id = NULL WHERE telegram_id = ? AND id != ?',
          [chatId, session.user_id]
        );

      // Теперь безопасно ставим telegram_id для текущего пользователя
        await connection.execute(
          'UPDATE users SET telegram_id = ? WHERE id = ?',
          [chatId, session.user_id]
        );

        bot.sendMessage(chatId, '✅ Вход выполнен. Напиши /list для списка дел, /remind для напоминания, /logout чтобы выйти.');
      } else {
        delete sessions[chatId];
        bot.sendMessage(chatId, '❌ Неверные данные. Попробуй /login снова.');
      }
      await connection.end();
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, 'Ошибка при проверке данных.');
    }
  } else if (session.stage === 'awaiting_remind_details') {
    const parts = msg.text.trim().split(' ');
    if (parts.length !== 3) {
      bot.sendMessage(chatId, 'Неверный формат. Пример: 1 21.06.2025 23:30');
      return;
    }

    const [taskNumberStr, dateStr, timeStr] = parts;
    const taskNumber = parseInt(taskNumberStr, 10);
    if (isNaN(taskNumber)) {
      bot.sendMessage(chatId, 'Неверный номер задачи.');
      return;
    }

    const dateTime = parseDateTime(`${dateStr} ${timeStr}`);
    if (!dateTime) {
      bot.sendMessage(chatId, 'Неверный формат даты или времени.');
      return;
    }

    try {
      const connection = await mysql.createConnection(dbConfig);
      const [items] = await connection.execute(
        'SELECT id, text FROM items WHERE user_id = ?',
        [session.user_id]
      );

      if (taskNumber < 1 || taskNumber > items.length) {
        bot.sendMessage(chatId, 'Такой задачи нет. Используй /list чтобы посмотреть номера.');
        await connection.end();
        return;
      }

      const task = items[taskNumber - 1];

      await connection.execute(
        'INSERT INTO reminders (user_id, task_id, remind_at) VALUES (?, ?, ?)',
        [session.user_id, task.id, formatDateTimeForSQL(dateTime)]
      );
      await connection.end();

      bot.sendMessage(chatId, `🔔 Напоминание установлено на ${dateStr} ${timeStr} для задачи "${task.text}"`);
      session.stage = 'logged_in';

    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, 'Ошибка при создании напоминания.');
      session.stage = 'logged_in';
    }
  }
});

// 🔄 Проверка напоминаний каждую минуту
setInterval(async () => {
  const now = new Date();
  const utcNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000); // Переводим в UTC
  const nowFormatted = formatDateTimeForSQL(utcNow);
  console.log('🕒 Проверка напоминаний на:', nowFormatted);

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [reminders] = await connection.execute(`
      SELECT r.id, r.user_id, r.task_id, u.telegram_id, i.text
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      JOIN items i ON r.task_id = i.id
      WHERE r.remind_at <= ?
    `, [nowFormatted]);

    for (const reminder of reminders) {
      console.log(`🔔 Отправка напоминания для user_id=${reminder.user_id}: ${reminder.text}`);
      const message = `🔔 Напоминание!\nВы должны выполнить: "${reminder.text}"`;
      if (reminder.telegram_id) {
        bot.sendMessage(reminder.telegram_id, message);
      }
      await connection.execute('DELETE FROM reminders WHERE id = ?', [reminder.id]);
    }

    await connection.end();
  } catch (err) {
    console.error('Ошибка проверки напоминаний:', err);
  }
}, 60 * 1000);

// 📦 Вспомогательные функции

function parseDateTime(str) {
  const dtRegex = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/;
  const match = dtRegex.exec(str);
  if (!match) return null;
  const [_, day, month, year, hour, minute] = match;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute)); // UTC
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTimeForSQL(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}
