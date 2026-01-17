const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

async function retrieveListItems(username) {
    const connection = await mysql.createConnection(dbConfig);
    const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (userRows.length === 0) return [];

    const userId = userRows[0].id;
    const [rows] = await connection.execute('SELECT id, text, done FROM items WHERE user_id = ?', [userId]);
    await connection.end();
    return rows;
}

async function getHtmlRows(username) {
    const todoItems = await retrieveListItems(username);
    return todoItems.map(item =>
        `<tr>
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td>
                <button onclick="editItem(${item.id})">✎</button>
                <button onclick="deleteItem(${item.id})">×</button>
            </td>
        </tr>`
    ).join('');
}

async function handleRequest(req, res) {
    if (req.url === '/') {
        const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
        const processedHtml = html.replace('{{rows}}', await getHtmlRows('guest'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(processedHtml);

    } else if (req.url === '/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);
            try {
                await connection.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
                res.writeHead(200);
                res.end();
            } catch (err) {
                res.writeHead(400);
                res.end('User exists');
            }
            await connection.end();
        });

    } else if (req.url === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
            await connection.end();

            if (rows.length === 1) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ username }));
            } else {
                res.writeHead(401);
                res.end('Invalid credentials');
            }
        });

    } else if (req.url.startsWith('/items') && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const username = url.searchParams.get('username');

        const items = await retrieveListItems(username);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));

    } else if (req.url === '/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { text, username } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);

            const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
            if (userRows.length === 0) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false }));
                await connection.end();
                return;
            }

            const userId = userRows[0].id;
            await connection.execute('INSERT INTO items (text, user_id) VALUES (?, ?)', [text, userId]);
            await connection.end();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });

    } else if (req.url === '/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { id, username } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);

            const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
            if (userRows.length === 0) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false }));
                await connection.end();
                return;
            }

            const userId = userRows[0].id;
            await connection.execute('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId]);
            await connection.end();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });

    } else if (req.url === '/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { id, text, username } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);

            const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
            if (userRows.length === 0) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false }));
                await connection.end();
                return;
            }

            const userId = userRows[0].id;
            await connection.execute('UPDATE items SET text = ? WHERE id = ? AND user_id = ?', [text, id, userId]);
            await connection.end();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });

    } else if (req.url === '/mark' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { id, done, username } = JSON.parse(body);
            const connection = await mysql.createConnection(dbConfig);

            const [userRows] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
            if (userRows.length === 0) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false }));
                await connection.end();
                return;
            }

            const userId = userRows[0].id;
            await connection.execute('UPDATE items SET done = ? WHERE id = ? AND user_id = ?', [done, id, userId]);
            await connection.end();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });

    } else if (req.url.endsWith('.html')) {
        const filePath = path.join(__dirname, req.url);
        try {
            const html = await fs.promises.readFile(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('HTML file not found');
        }

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
