import OpenAI from 'openai';

// Configuración OpenRouter
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://tutienda.com",
    "X-Title": "Personal Shopper VTEX",
  }
});

// Configuración VTEX
const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; // Ej: 'jumboargentina'

export default async function handler(req, res) {
  // 1. MANEJO DE CORS (Vital para Dynamic Yield)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Permite que DY llame desde la tienda
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;

  try {
    // 2. IA: Extraer términos de búsqueda (JSON)
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-lite-preview-02-05:free", // O tu modelo preferido de OpenRouter
      messages: [
        {
          role: "system",
          content: `Eres un experto en e-commerce. Tu trabajo es interpretar lo que pide el usuario y extraer TÉRMINOS DE BÚSQUEDA para un catálogo VTEX.
          
          Reglas:
          1. Si pide "ingredientes para una torta", devuelve: ["harina leudante", "huevos", "azucar", "leche"].
          2. Si pide "celular samsung", devuelve: ["celular samsung"].
          3. Responde SOLAMENTE con un JSON Array de strings. Sin texto extra.`
        },
        { role: "user", content: message }
      ],
    });

    let searchTerms = [];
    try {
      const cleanContent = completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      searchTerms = JSON.parse(cleanContent);
    } catch (e) {
      searchTerms = [message];
    }

    // 3. VTEX: Buscar productos reales
    const productPromises = searchTerms.map(async (term) => {
      // Usamos el endpoint público de VTEX
      const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=2`;
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) return [];
        return await response.json();
      } catch (err) { return []; }
    });

    const rawResults = await Promise.all(productPromises);

    // 4. FORMATEAR PARA DY
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        const item = p.items[0];
        const seller = item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images[0] ? item.images[0].imageUrl : 'https://placehold.co/200',
            price: seller ? `$${seller.commertialOffer.Price.toLocaleString('es-AR')}` : "Ver Precio",
            link: p.linkText ? `/${p.linkText}/p` : '#' // Link relativo para que funcione en el mismo dominio
        };
    }).filter(p => p !== null);

    // Eliminar duplicados
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    res.status(200).json({
      reply: `Busqué opciones para: **${searchTerms.join(", ")}**.`,
      products: uniqueProducts
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor Vercel' });
  }
}
