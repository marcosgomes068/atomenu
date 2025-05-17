require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const sharp = require('sharp');
const app = express();
const PORT = 3000;
const DBSOURCE = path.join(__dirname, 'db.sqlite');
const uploadDir = path.join(__dirname, '../frontend/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, 'produto_' + Date.now() + ext);
    }
});
const upload = multer({ storage });

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json()); // Permite receber JSON no body das requisições

app.use(session({
    secret: 'allcatalog_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 } // 2 horas
}));

// Middleware para proteger rotas
function requireLogin(req, res, next) {
    if (!req.session.usuarioId) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });
    }
    next();
}

// Inicializa o banco e cria tabela se não existir
const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
        console.error('Erro ao abrir o banco:', err.message);
    } else {
        db.run(`CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            senha TEXT NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS cardapio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            categoria_id INTEGER,
            titulo TEXT NOT NULL,
            descricao TEXT,
            preco REAL NOT NULL,
            promocao INTEGER DEFAULT 0,
            imagem TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY(categoria_id) REFERENCES categorias(id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS whatsapp (
            usuario_id INTEGER PRIMARY KEY,
            numero TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        db.run(`ALTER TABLE usuarios ADD COLUMN plano TEXT DEFAULT 'free'`, () => {});
        db.run(`ALTER TABLE cardapio ADD COLUMN categoria_id INTEGER`, () => {});
        db.run(`ALTER TABLE cardapio ADD COLUMN promocao INTEGER DEFAULT 0`, () => {});
        // Garante que a coluna imagem existe na tabela cardapio
        // (executa sem erro se já existir)
        db.run("ALTER TABLE cardapio ADD COLUMN imagem TEXT", () => {});
        // Mensagem personalizada do pedido (por usuário)
        db.run(`CREATE TABLE IF NOT EXISTS msg_personalizada (
            usuario_id INTEGER PRIMARY KEY,
            msg TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        // Tabela para armazenar QR code do cardápio por usuário
        db.run(`CREATE TABLE IF NOT EXISTS qrcodes (
            usuario_id INTEGER PRIMARY KEY,
            qr_base64 TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        // Tabela para armazenar logo do restaurante
        db.run(`CREATE TABLE IF NOT EXISTS logos (
            usuario_id INTEGER PRIMARY KEY,
            logo_path TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS titulos_publicos (
            usuario_id INTEGER PRIMARY KEY,
            titulo TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS cores_publico (
            usuario_id INTEGER PRIMARY KEY,
            fundo TEXT,
            destaque TEXT,
            card TEXT,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )`);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/chat.html'));
});

// Rotas explícitas para páginas de desenvolvedor (corrige acesso direto)
app.get('/dev/homeded.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dev/homeded.html'));
});
app.get('/dev/painel.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dev/painel.html'));
});

app.get('/logincad.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/logincad.html'));
});

app.get('/restaurante.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/restaurante.html'));
});

app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/styles.css'));
});

// Rota para servir arquivos estáticos de dev (corrige o erro Cannot GET)
app.use('/dev', express.static(path.join(__dirname, '../frontend/dev')));

// Cadastro de usuário
app.post('/api/cadastro', (req, res) => {
    const { usuario, email, senha } = req.body;
    if (!usuario || !email || !senha) {
        return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });
    }
    db.get('SELECT id FROM usuarios WHERE usuario = ? OR email = ?', [usuario, email], (err, row) => {
        if (row) {
            return res.json({ sucesso: false, mensagem: 'Usuário ou email já cadastrado.' });
        }
        db.run('INSERT INTO usuarios (usuario, email, senha) VALUES (?, ?, ?)', [usuario, email, senha], function(err) {
            if (err) {
                return res.json({ sucesso: false, mensagem: 'Erro no cadastro.' });
            }
            res.json({ sucesso: true });
        });
    });
});

// Login de usuário
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (!usuario || !senha) {
        return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });
    }
    db.get('SELECT id FROM usuarios WHERE (usuario = ? OR email = ?) AND senha = ?', [usuario, usuario, senha], (err, row) => {
        if (!row) {
            return res.json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });
        }
        req.session.usuarioId = row.id;
        res.json({ sucesso: true });
    });
});

// Endpoint para logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ sucesso: true });
    });
});

// Exemplo de rota protegida (pode ser usada no restaurante.html futuramente)
app.get('/api/userinfo', requireLogin, (req, res) => {
    db.get('SELECT id, usuario, email FROM usuarios WHERE id = ?', [req.session.usuarioId], (err, row) => {
        if (row) {
            res.json({ sucesso: true, usuario: row.usuario, email: row.email, usuarioId: row.id });
        } else {
            res.json({ sucesso: false });
        }
    });
});

// Função utilitária para buscar o plano do usuário
function getPlano(usuarioId, cb) {
    db.get('SELECT plano FROM usuarios WHERE id = ?', [usuarioId], (err, row) => {
        if (err || !row) return cb('free');
        cb(row.plano || 'free');
    });
}

// CRUD de categorias
app.get('/api/categorias', requireLogin, (req, res) => {
    db.all('SELECT id, nome FROM categorias WHERE usuario_id = ?', [req.session.usuarioId], (err, rows) => {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao buscar categorias.' });
        res.json({ sucesso: true, categorias: rows });
    });
});

app.post('/api/categorias', requireLogin, (req, res) => {
    const { nome } = req.body;
    if (!nome) return res.json({ sucesso: false, mensagem: 'Preencha o nome da categoria.' });
    getPlano(req.session.usuarioId, plano => {
        if (plano === 'free') {
            db.get('SELECT COUNT(*) as total FROM categorias WHERE usuario_id = ?', [req.session.usuarioId], (err, row) => {
                if (row && row.total >= 2) {
                    return res.json({ sucesso: false, mensagem: 'Plano free permite no máximo 2 categorias.' });
                }
                db.run('INSERT INTO categorias (usuario_id, nome) VALUES (?, ?)', [req.session.usuarioId, nome], function(err) {
                    if (err) return res.json({ sucesso: false, mensagem: 'Erro ao adicionar categoria.' });
                    res.json({ sucesso: true, id: this.lastID });
                });
            });
        } else {
            db.run('INSERT INTO categorias (usuario_id, nome) VALUES (?, ?)', [req.session.usuarioId, nome], function(err) {
                if (err) return res.json({ sucesso: false, mensagem: 'Erro ao adicionar categoria.' });
                res.json({ sucesso: true, id: this.lastID });
            });
        }
    });
});

app.delete('/api/categorias/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM categorias WHERE id = ? AND usuario_id = ?', [req.params.id, req.session.usuarioId], function(err) {
        if (err || this.changes === 0) return res.json({ sucesso: false, mensagem: 'Erro ao remover categoria.' });
        // Remove também os itens dessa categoria
        db.run('DELETE FROM cardapio WHERE categoria_id = ? AND usuario_id = ?', [req.params.id, req.session.usuarioId], () => {
            res.json({ sucesso: true });
        });
    });
});

// CRUD de itens do cardápio (agora com categoria)
app.post('/api/cardapio', requireLogin, (req, res) => {
    let { categoriaId, titulo, descricao, preco } = req.body;
    if (!titulo || !categoriaId) return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });
    if (preco === undefined || preco === null || preco === '') preco = 0;
    getPlano(req.session.usuarioId, plano => {
        if (plano === 'free') {
            db.get('SELECT COUNT(*) as total FROM cardapio WHERE usuario_id = ? AND categoria_id = ?', [req.session.usuarioId, categoriaId], (err, row) => {
                if (row && row.total >= 5) {
                    return res.json({ sucesso: false, mensagem: 'Plano free permite no máximo 5 produtos por categoria.' });
                }
                db.run('INSERT INTO cardapio (usuario_id, categoria_id, titulo, descricao, preco) VALUES (?, ?, ?, ?, ?)', [req.session.usuarioId, categoriaId, titulo, descricao || '', preco], function(err) {
                    if (err) return res.json({ sucesso: false, mensagem: 'Erro ao adicionar item.' });
                    res.json({ sucesso: true, id: this.lastID });
                });
            });
        } else {
            db.run('INSERT INTO cardapio (usuario_id, categoria_id, titulo, descricao, preco) VALUES (?, ?, ?, ?, ?)', [req.session.usuarioId, categoriaId, titulo, descricao || '', preco], function(err) {
                if (err) return res.json({ sucesso: false, mensagem: 'Erro ao adicionar item.' });
                res.json({ sucesso: true, id: this.lastID });
            });
        }
    });
});

app.delete('/api/cardapio/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM cardapio WHERE id = ? AND usuario_id = ?', [req.params.id, req.session.usuarioId], function(err) {
        if (err || this.changes === 0) return res.json({ sucesso: false, mensagem: 'Erro ao remover item.' });
        res.json({ sucesso: true });
    });
});

// Marcar/desmarcar promoção
app.patch('/api/cardapio/:id/promocao', requireLogin, (req, res) => {
    const { promocao } = req.body;
    db.run('UPDATE cardapio SET promocao = ? WHERE id = ? AND usuario_id = ?', [promocao ? 1 : 0, req.params.id, req.session.usuarioId], function(err) {
        if (err || this.changes === 0) return res.json({ sucesso: false, mensagem: 'Erro ao atualizar promoção.' });
        res.json({ sucesso: true });
    });
});

// Cardápio agrupado por categorias
app.get('/api/cardapio', requireLogin, (req, res) => {
    db.all('SELECT id, nome FROM categorias WHERE usuario_id = ?', [req.session.usuarioId], (err, categorias) => {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao buscar categorias.' });
        if (!categorias.length) return res.json({ sucesso: true, categorias: [] });
        db.all('SELECT * FROM cardapio WHERE usuario_id = ?', [req.session.usuarioId], (err2, itens) => {
            if (err2) return res.json({ sucesso: false, mensagem: 'Erro ao buscar itens.' });
            const agrupado = categorias.map(cat => ({
                id: cat.id,
                nome: cat.nome,
                itens: itens.filter(i => i.categoria_id === cat.id).map(i => ({
                    id: i.id,
                    titulo: i.titulo,
                    descricao: i.descricao,
                    preco: i.preco,
                    promocao: !!i.promocao
                }))
            }));
            res.json({ sucesso: true, categorias: agrupado });
        });
    });
});

// WhatsApp: salvar e carregar número
app.post('/api/whatsapp', requireLogin, (req, res) => {
    getPlano(req.session.usuarioId, plano => {
        if (plano === 'free') {
            return res.json({ sucesso: false, mensagem: 'WhatsApp disponível apenas no plano premium.' });
        }
        const { numero } = req.body;
        if (!numero) return res.json({ sucesso: false, mensagem: 'Informe o número.' });
        db.run('INSERT INTO whatsapp (usuario_id, numero) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET numero=excluded.numero', [req.session.usuarioId, numero], function(err) {
            if (err) return res.json({ sucesso: false, mensagem: 'Erro ao salvar número.' });
            res.json({ sucesso: true });
        });
    });
});

app.get('/api/whatsapp', requireLogin, (req, res) => {
    getPlano(req.session.usuarioId, plano => {
        if (plano === 'free') {
            return res.json({ sucesso: false, numero: '', mensagem: 'WhatsApp disponível apenas no plano premium.' });
        }
        db.get('SELECT numero FROM whatsapp WHERE usuario_id = ?', [req.session.usuarioId], (err, row) => {
            if (err) return res.json({ sucesso: false });
            res.json({ sucesso: true, numero: row ? row.numero : '' });
        });
    });
});

// QR Code do cardápio (gera base64 PNG)
const QRCode = require('qrcode');
// Endpoint para gerar ou retornar QR code do cardápio público
app.get('/api/qrcode', requireLogin, (req, res) => {
    const usuarioId = req.session.usuarioId;
    db.get('SELECT qr_base64 FROM qrcodes WHERE usuario_id = ?', [usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao buscar QR code.' });
        if (row && row.qr_base64) {
            return res.json({ sucesso: true, qr: row.qr_base64 });
        }
        // Gera QR code se não existir
        const url = `${process.env.PUBLIC_URL || ''}/cardapio.html?id=${usuarioId}`;
        QRCode.toDataURL(url, { width: 320 }, (err, qr_base64) => {
            if (err) return res.json({ sucesso: false, mensagem: 'Erro ao gerar QR code.' });
            db.run('INSERT INTO qrcodes (usuario_id, qr_base64) VALUES (?, ?)', [usuarioId, qr_base64], (err2) => {
                if (err2) return res.json({ sucesso: false, mensagem: 'Erro ao salvar QR code.' });
                res.json({ sucesso: true, qr: qr_base64 });
            });
        });
    });
});

// Página pública do cardápio (visualização para clientes)
app.get('/cardapio/:usuarioId', (req, res) => {
    // Página pública minimalista do cardápio
    res.send(`
<html><head><title>Cardápio</title><meta name='viewport' content='width=device-width,initial-scale=1.0'></head>
<body style='background:#101014;color:#fff;font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;'>
<h1>Cardápio</h1>
<div id='conteudo'>Carregando...</div>
<script>
fetch('/api/cardapio_publico/${req.params.usuarioId}')
  .then(r=>r.json())
  .then(data=>{
    let html='';
    data.categorias.forEach(function(cat){
      html+='<h2>'+cat.nome+'</h2><ul>';
      cat.itens.forEach(function(i){
        html+='<li><b>'+i.titulo+'</b> - R$ '+i.preco.toFixed(2)+' '+(i.promocao?'🔥':'')+'<br><small>'+(i.descricao||'')+'</small></li>';
      });
      html+='</ul>';
    });
    document.getElementById('conteudo').innerHTML=html;
  });
</script>
</body></html>
`);
});

app.get('/api/cardapio_publico/:usuarioId', (req, res) => {
    db.all('SELECT id, nome FROM categorias WHERE usuario_id = ?', [req.params.usuarioId], (err, categorias) => {
        if (err) return res.json({ sucesso: false, categorias: [] });
        if (!categorias.length) return res.json({ sucesso: true, categorias: [] });
        db.all('SELECT * FROM cardapio WHERE usuario_id = ?', [req.params.usuarioId], (err2, itens) => {
            if (err2) return res.json({ sucesso: false, categorias: [] });
            const agrupado = categorias.map(cat => ({
                id: cat.id,
                nome: cat.nome,
                itens: itens.filter(i => i.categoria_id === cat.id).map(i => ({
                    id: i.id,
                    titulo: i.titulo,
                    descricao: i.descricao,
                    preco: i.preco,
                    promocao: !!i.promocao,
                    imagem: i.imagem || ''
                }))
            }));
            res.json({ sucesso: true, categorias: agrupado });
        });
    });
});

// Endpoint para listar todos os usuários (apenas para desenvolvedor)
app.get('/api/dev/usuarios', (req, res) => {
    // Simples: sem autenticação, só para protótipo. Em produção, proteger!
    db.all('SELECT id, usuario, email, plano FROM usuarios', (err, rows) => {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao buscar usuários.' });
        res.json({ sucesso: true, usuarios: rows });
    });
});

// Endpoint para atualizar o plano de um usuário
app.post('/api/dev/usuario/:id/plano', (req, res) => {
    const { plano } = req.body;
    db.run('UPDATE usuarios SET plano = ? WHERE id = ?', [plano, req.params.id], function(err) {
        if (err || this.changes === 0) return res.json({ sucesso: false, mensagem: 'Erro ao atualizar plano.' });
        res.json({ sucesso: true });
    });
});

// Endpoint para listar arquivos em /uploads (depuração)
app.get('/api/uploads', (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) {
            console.error('Erro ao listar uploads:', err);
            return res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar arquivos.' });
        }
        res.json({ sucesso: true, arquivos: files });
    });
});

// Servir imagens estáticas (agora suporta subpasta)
app.use('/uploads', express.static(uploadDir, {
    setHeaders: (res, filePath) => {
        res.set('Content-Type', 'image/jpeg'); // força JPEG para consistência
    }
}));

// --- INÍCIO MELHORIAS UPLOADS E FEEDBACK ---
// Função para obter diretório de upload do usuário
function getUserUploadDir(usuarioId) {
    const dir = path.join(uploadDir, String(usuarioId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Novo storage do multer para salvar em subpasta do usuário
const storageUser = multer.diskStorage({
    destination: function (req, file, cb) {
        // Só funciona para rotas autenticadas
        const usuarioId = req.session?.usuarioId;
        if (!usuarioId) return cb(new Error('Usuário não autenticado'), null);
        cb(null, getUserUploadDir(usuarioId));
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'produto_' + Date.now() + ext);
    }
});
const uploadUser = multer({ storage: storageUser });

// Endpoint para upload de imagem de produto (agora em subpasta do usuário)
app.post('/api/cardapio/:id/imagem', requireLogin, uploadUser.single('imagem'), async (req, res) => {
    if (!req.file) return res.json({ sucesso: false, mensagem: 'Nenhuma imagem enviada.' });
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(req.file.originalname).toLowerCase();
    let filePath = `/uploads/${req.session.usuarioId}/${req.file.filename}`;
    // Se não for jpg, jpeg ou png, converte para jpg
    if (!allowed.includes(ext)) {
        const newFilename = 'produto_' + Date.now() + '.jpg';
        const newPath = path.join(getUserUploadDir(req.session.usuarioId), newFilename);
        try {
            await sharp(req.file.path).jpeg({ quality: 90 }).toFile(newPath);
            fs.unlinkSync(req.file.path); // remove o arquivo original
            filePath = `/uploads/${req.session.usuarioId}/${newFilename}`;
        } catch (e) {
            return res.json({ sucesso: false, mensagem: 'Erro ao converter imagem. Formato não suportado.' });
        }
    }
    // Log para depuração
    console.log('Tentando atualizar imagem do item:', req.params.id, 'usuario:', req.session.usuarioId, 'filePath:', filePath);
    db.run('UPDATE cardapio SET imagem = ? WHERE id = ? AND usuario_id = ?', [filePath, req.params.id, req.session.usuarioId], function(err) {
        console.log('Resultado UPDATE imagem:', { err, changes: this.changes });
        if (err || this.changes === 0) return res.json({ sucesso: false, mensagem: 'Erro ao salvar imagem no banco.' });
        res.json({ sucesso: true, imagem: filePath });
    });
});

// Upload de logo do restaurante
const uploadLogo = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const usuarioId = req.session?.usuarioId;
            if (!usuarioId) return cb(new Error('Usuário não autenticado'), null);
            const dir = path.join(uploadDir, String(usuarioId));
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: function (req, file, cb) {
            cb(null, 'logo_' + Date.now() + path.extname(file.originalname).toLowerCase());
        }
    })
});

app.post('/api/logo', requireLogin, uploadLogo.single('logo'), async (req, res) => {
    if (!req.file) return res.json({ sucesso: false, mensagem: 'Nenhuma logo enviada.' });
    // Converte para PNG e salva
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newFilename = 'logo_' + Date.now() + '.png';
    const newPath = path.join(getUserUploadDir(req.session.usuarioId), newFilename);
    try {
        await sharp(req.file.path).png({ quality: 90 }).toFile(newPath);
        fs.unlinkSync(req.file.path); // remove o original
        const logoPath = `/uploads/${req.session.usuarioId}/${newFilename}`;
        db.run('INSERT INTO logos (usuario_id, logo_path) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET logo_path=excluded.logo_path', [req.session.usuarioId, logoPath], function(err) {
            if (err) return res.json({ sucesso: false, mensagem: 'Erro ao salvar logo.' });
            res.json({ sucesso: true, logo: logoPath });
        });
    } catch (e) {
        return res.json({ sucesso: false, mensagem: 'Erro ao processar logo.' });
    }
});

// Endpoint público para buscar logo
app.get('/api/logo_publica/:usuarioId', (req, res) => {
    db.get('SELECT logo_path FROM logos WHERE usuario_id = ?', [req.params.usuarioId], (err, row) => {
        if (err || !row) return res.json({ sucesso: false });
        res.json({ sucesso: true, logo: row.logo_path });
    });
});

// Salvar mensagem personalizada
app.post('/api/msg_personalizada', requireLogin, (req, res) => {
    const { msg } = req.body;
    if (!msg || msg.length < 3) return res.json({ sucesso: false, mensagem: 'Mensagem muito curta.' });
    db.run('INSERT INTO msg_personalizada (usuario_id, msg) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET msg=excluded.msg', [req.session.usuarioId, msg], function(err) {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao salvar mensagem.' });
        res.json({ sucesso: true });
    });
});

// Carregar mensagem personalizada
app.get('/api/msg_personalizada', requireLogin, (req, res) => {
    db.get('SELECT msg FROM msg_personalizada WHERE usuario_id = ?', [req.session.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, msg: row ? row.msg : '' });
    });
});

// Endpoint público para buscar mensagem personalizada de qualquer usuário
app.get('/api/msg_personalizada_publica/:usuarioId', (req, res) => {
    db.get('SELECT msg FROM msg_personalizada WHERE usuario_id = ?', [req.params.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, msg: row ? row.msg : '' });
    });
});

// Salvar título público
app.post('/api/titulo_publico', requireLogin, (req, res) => {
    const { titulo } = req.body;
    if (!titulo || titulo.length < 2) return res.json({ sucesso: false, mensagem: 'Título muito curto.' });
    db.run('INSERT INTO titulos_publicos (usuario_id, titulo) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET titulo=excluded.titulo', [req.session.usuarioId, titulo], function(err) {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao salvar título.' });
        res.json({ sucesso: true });
    });
});
// Buscar título público
app.get('/api/titulo_publico', requireLogin, (req, res) => {
    db.get('SELECT titulo FROM titulos_publicos WHERE usuario_id = ?', [req.session.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, titulo: row ? row.titulo : '' });
    });
});
// Endpoint público para exibir título no cardápio
app.get('/api/titulo_publico/:usuarioId', (req, res) => {
    db.get('SELECT titulo FROM titulos_publicos WHERE usuario_id = ?', [req.params.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, titulo: row ? row.titulo : '' });
    });
});

// Salvar cores do cardápio público
app.post('/api/cores_publico', requireLogin, (req, res) => {
    const { fundo, destaque, card } = req.body;
    db.run('INSERT INTO cores_publico (usuario_id, fundo, destaque, card) VALUES (?, ?, ?, ?) ON CONFLICT(usuario_id) DO UPDATE SET fundo=excluded.fundo, destaque=excluded.destaque, card=excluded.card', [req.session.usuarioId, fundo, destaque, card], function(err) {
        if (err) return res.json({ sucesso: false, mensagem: 'Erro ao salvar cores.' });
        res.json({ sucesso: true });
    });
});

// Buscar cores do cardápio público
app.get('/api/cores_publico', requireLogin, (req, res) => {
    db.get('SELECT fundo, destaque, card FROM cores_publico WHERE usuario_id = ?', [req.session.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, cores: row || {} });
    });
});

// Endpoint público para exibir cores no cardápio
app.get('/api/cores_publico/:usuarioId', (req, res) => {
    db.get('SELECT fundo, destaque, card FROM cores_publico WHERE usuario_id = ?', [req.params.usuarioId], (err, row) => {
        if (err) return res.json({ sucesso: false });
        res.json({ sucesso: true, cores: row || {} });
    });
});

// Garante que o servidor Express será iniciado
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
