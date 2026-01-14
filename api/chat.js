import OpenAI from 'openai';

// --- CONFIGURACIÓN DE OPENAI / OPENROUTER ---
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app",
    "X-Title": "Personal Shopper VTEX",
  }
});

// --- EL WRAPPER MÁGICO (CORS) ---
// Esta función envuelve a tu handler y fuerza los headers SIEMPRE.
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )
  
  // Si es un preflight, respondemos OK y cortamos aquí.
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  
  // Si no es OPTIONS, ejecutamos tu función real.
  return await fn(req, res)
}

// --- TU LÓGICA REAL ---
const handler = async (req, res) => {
  // Solo permitimos POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; 

  try {
    // 1. CEREBRO IA
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-lite-preview-02-05:free", 
      messages: [
        {
          role: "system",
          content: `Eres un experto en e-commerce. Extrae TÉRMINOS DE BÚSQUEDA en JSON Array.
          Ej: "leche y pan" -> ["leche", "pan"]. Responde SOLO JSON.`
        },
        { role: "user", content: message }
      ],
    });

    // Parseo seguro
    let searchTerms = [];
    try {
      const cleanContent = completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      searchTerms = JSON.parse(cleanContent);
    } catch (e) {
      searchTerms = [message];
    }

    // 2. BUSCAR EN VTEX
    const productPromises = searchTerms.map(async (term) => {
      const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=2`;
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) return [];
        return await response.json();
      } catch (err) { return []; }
    });

    const rawResults = await Promise.all(productPromises);

    // 3. LIMPIEZA DE DATOS
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        const item = p.items[0];
        const seller = item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images[0] ? item.images[0].imageUrl : 'https://via.placeholder.com/150',
            price: seller ? `$${seller.commertialOffer.Price.toLocaleString('es-AR')}` : "Ver Precio",
            link: p.linkText ? `/${p.linkText}/p` : '#'
        };
    }).filter(p => p !== null);

    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    res.status(200).json({
      reply: `Resultados para: **${searchTerms.join(", ")}**.`,
      products: uniqueProducts
    });

  } catch (error) {
    console.error("Server Error:", error);
    // IMPORTANTE: Devolvemos error JSON para que el frontend lo lea
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}

// Exportamos el handler envuelto en el wrapper de CORS
export default allowCors(handler);
