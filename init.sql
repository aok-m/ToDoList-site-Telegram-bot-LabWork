CREATE DATABASE IF NOT EXISTS todolist;
USE todolist;

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,  -- Логин пользователя
    password VARCHAR(255) NOT NULL,         -- Пароль пользователя 
    telegram_id BIGINT UNIQUE               -- ID пользователя в Telegram для отправки уведомлений
);

-- Таблица задач (items), связанных с пользователями
CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    text VARCHAR(255) NOT NULL,             -- Текст задачи
    user_id INT,                           -- Владелец задачи (ссылка на users.id)
    done BOOLEAN DEFAULT FALSE,            -- Статус задачи: выполнена/не выполнена
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Таблица напоминаний
CREATE TABLE IF NOT EXISTS reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,                  -- Владелец напоминания
    task_id INT NOT NULL,                  -- Задача, на которую установлено напоминание (items.id)
    remind_at DATETIME NOT NULL,           -- Время напоминания
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES items(id) ON DELETE CASCADE
);
