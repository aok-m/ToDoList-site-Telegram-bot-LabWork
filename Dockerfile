FROM node:18

# Создание рабочей директории
WORKDIR /app

# Копируем зависимости
COPY package*.json ./
RUN npm install

# Копируем весь проект
COPY . .

# Указываем порт
EXPOSE 3000

# Запуск сервера
CMD ["node", "index.js"]
