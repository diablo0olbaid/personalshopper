import OpenAI from 'openai';

// Configuración OpenRouter
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app",
    "X-Title": "Personal Shopper VTEX",
  }
});

export default async function handler(req, res) {
  // ==========================================
  // 🛡️ ESCUDO CORS (La solución al error rojo)
  // ==========================================
  res.setHeader('Access-Control-Allow-Credentials', true);
  // El '*' permite que CUALQUIER web use tu API. 
  // Para producción real podrías poner 'https://www.carrefour.com.ar'
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Si el navegador pregunta "¿Puedo pasar?" (OPTIONS), le decimos que SÍ y cortamos aquí.
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  // ==========================================

  // Solo permitimos POST para la lógica real
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; 

  try {
    // 1. CEREBRO IA: Extraer términos
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-lite-preview-02-05:free", // O 'openai/gpt-3.5-turbo'
      messages: [
        {
          role: "system",
          content: `Eres un experto en e-commerce. Tu trabajo es interpretar lo que pide el usuario y extraer TÉRMINOS DE BÚSQUEDA para un catálogo.
          
          Reglas:
          1. Si pide "ingredientes para una torta", devuelve: ["harina leudante", "huevos", "azucar", "leche"].
          2. Si pide "celular samsung", devuelve: ["celular samsung"].
          3. Responde SOLAMENTE con un JSON Array de strings. Sin texto extra.`
        },
        { role: "user", content: message }
      ],
    });

    // Limpieza de respuesta IA
    let searchTerms = [];
    try {
      const cleanContent = completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      searchTerms = JSON.parse(cleanContent);
    } catch (e) {
      console.error("Error parseando JSON de IA", e);
      searchTerms = [message];
    }

    // 2. BUSCAR EN VTEX
    const productPromises = searchTerms.map(async (term) => {
      // Usamos el endpoint público
      const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=2`;
      
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) return [];
        return await response.json();
      } catch (err) {
        return [];
      }
    });

    const rawResults = await Promise.all(productPromises);

    // 3. FORMATEAR RESPUESTA
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        const item = p.items[0];
        const seller = item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images && item.images.length > 0 ? item.images[0].imageUrl : 'https://placehold.co/200',
            price: seller ? `$${seller.commertialOffer.Price.toLocaleString('es-AR')}` : "Ver Precio",
            link: p.linkText ? `/${p.linkText}/p` : '#' // Link relativo
        };
    }).filter(p => p !== null);

    // Eliminar duplicados
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    res.status(200).json({
      reply: `He buscado opciones para: **${searchTerms.join(", ")}**.`,
      products: uniqueProducts
    });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: 'Error interno en Vercel (IA o VTEX)' });
  }
}
