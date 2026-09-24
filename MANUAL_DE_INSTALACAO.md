# Multiplayer Poker & Blackjack 21

Este é um jogo multiplayer em tempo real de Poker (Texas Hold'em) e Blackjack (21), construído para ser rápido, leve e rodar diretamente no navegador sem necessidade de banco de dados complexos (funciona com gerenciamento de estado em memória).

## 🛠 Tecnologias Utilizadas
- **Backend:** Node.js, Express
- **Comunicação em Tempo Real:** Socket.io
- **Frontend:** HTML5, CSS3, JavaScript puro (Vanilla)

---

## 💻 Como rodar o projeto localmente (No seu computador)

Para testar e modificar o jogo na sua máquina, siga os passos abaixo:

1. **Instale o Node.js**: Baixe e instale a versão mais recente do [Node.js](https://nodejs.org/).
2. **Abra o terminal**: Navegue até a pasta onde você descompactou este projeto.
3. **Instale as dependências**:
   Execute o comando abaixo para baixar as bibliotecas necessárias (Express, Socket.io, etc):
   ```bash
   npm install
   ```
4. **Inicie o servidor local**:
   ```bash
   npm start
   ```
5. **Jogue!**
   Abra o seu navegador e acesse: `http://localhost:3000`

---

## 🚀 Como hospedar online gratuitamente (Usando o Render.com)

O projeto foi arquitetado para rodar perfeitamente no [Render.com](https://render.com/), que é uma plataforma gratuita e fácil de usar. 

### Passo a passo para colocar no ar:
1. Crie uma conta gratuita no [Render](https://render.com/).
2. É altamente recomendado que você suba este código para o seu próprio **GitHub**. Se fizer isso, basta conectar seu GitHub ao Render.
3. No painel do Render, clique em **"New"** e escolha **"Web Service"**.
4. Conecte o repositório do GitHub (ou faça o upload do código).
5. Preencha as configurações do servidor da seguinte forma:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free` (Gratuito)
6. Clique em **"Create Web Service"**.
7. Aguarde alguns minutos. O Render vai instalar tudo e te dar um link (ex: `https://seu-jogo.onrender.com`). Pronto, o site está online para o mundo todo jogar!

---

## ⚙️ Estrutura do Código
- **`/server/`**: Contém a lógica pesada do backend (`index.js` gerencia as conexões, `roomManager.js` as salas, `blackjack.js` e `poker.js` as regras de cada jogo).
- **`/public/`**: Contém a interface do usuário, imagens e áudios. 
  - Para trocar sons, basta substituir os arquivos `.mp3` na pasta `/public/sounds/`.
  - O arquivo `app.js` gerencia as telas e `poker.js` / `blackjack.js` (no frontend) gerenciam as animações.

Bom proveito com o projeto!
