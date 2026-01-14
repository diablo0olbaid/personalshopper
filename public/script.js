/* public/script.js */
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const chatArea = document.getElementById('chatArea');
const typingIndicator = document.getElementById('typing');

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    // UI: Mensaje Usuario
    addMessage(text, 'user');
    userInput.value = '';
    typingIndicator.style.display = 'block';

    try {
        // --- LLAMADA REAL A TU BACKEND ---
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });

        const data = await response.json();
        
        typingIndicator.style.display = 'none';

        // UI: Respuesta del Bot
        addMessage(data.aiReply, 'bot');

        // UI: Productos Reales
        if (data.products && data.products.length > 0) {
            renderCarousel(data.products);
        } else {
            addMessage("No encontré productos en VTEX para eso 😔", 'bot');
        }

    } catch (error) {
        typingIndicator.style.display = 'none';
        addMessage("Error de conexión con el servidor.", 'bot');
    }
}

// (Las funciones addMessage y renderCarousel son las mismas que te pasé antes en el CSS/HTML)
// Asegúrate de usar las propiedades correctas de VTEX (p.name, p.img, p.price)
function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.innerHTML = text;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function renderCarousel(products) {
    const grid = document.createElement('div');
    grid.className = 'product-grid';
    products.forEach(p => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <img src="${p.img}" class="product-img">
            <div class="product-name">${p.name}</div>
            <div class="product-price">$${p.price}</div>
            <button class="add-btn">Agregar</button>
        `;
        grid.appendChild(card);
    });
    chatArea.appendChild(grid);
    chatArea.scrollTop = chatArea.scrollHeight;
}
