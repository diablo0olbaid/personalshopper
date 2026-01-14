import OpenAI from 'openai';

// 1. Configuración de OpenRouter
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY, // TU KEY DE OPENROUTER
  baseURL: "https://openrouter.ai/api/v1", // URL de OpenRouter
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app", // Tu URL (opcional)
    "X-Title": "Personal Shopper VTEX",
  }
});

export default async function handler(req, res) {
  // Solo permitir POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  
  // VARIABLES DE ENTORNO (Configuradas en Vercel)
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; // Ej: jumboargentina
  const VTEX_ENV = "vtexcommercestable.com.br"; // Entorno estándar

  try {
    // 2. CEREBRO IA (OpenRouter)
    // Usamos 'google/gemini-2.0-flash-lite-preview-02-05:free' o 'openai/gpt-3.5-turbo' (barato y rápido)
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-lite-preview-02-05:free", // Modelo recomendado en OpenRouter (o usa el que prefieras)
      messages: [
        {
          role: "system",
          content: `Eres un experto en e-commerce. Tu trabajo es interpretar lo que pide el usuario y extraer TÉRMINOS DE BÚSQUEDA para un catálogo.
          
          Reglas:
          1. Si el usuario pide "ingredientes para una pizza", devuelve una lista: ["harina", "tomate triturado", "queso mozzarella"].
          2. Si el usuario pide un producto específico "Iphone 15", devuelve: ["iphone 15"].
          3. Responde SOLAMENTE con un JSON Array de strings. Sin texto extra.`
        },
        { role: "user", content: message }
      ],
    });

    // Parseamos la respuesta de la IA
    let searchTerms = [];
    try {
      // Limpiamos por si la IA devuelve bloques de código markdown
      const cleanContent = completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
      searchTerms = JSON.parse(cleanContent);
    } catch (e) {
      console.error("Error parseando IA:", e);
      searchTerms = [message]; // Fallback: buscar el mensaje tal cual
    }

    // 3. BÚSQUEDA EN VTEX (En paralelo)
    // Endpoint público: /api/catalog_system/pub/products/search/{term}
    const productPromises = searchTerms.map(async (term) => {
      const vtexUrl = `https://${VTEX_ACCOUNT}.${VTEX_ENV}/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=2`; // Traemos max 3 productos por término
      
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) return [];
        return await response.json();
      } catch (err) {
        return [];
      }
    });

    const rawResults = await Promise.all(productPromises);

    // 4. FORMATEO DE DATOS
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;

        const item = p.items[0]; // Primer SKU
        const seller = item.sellers[0]; // Primer vendedor
        
        // Intentar obtener la mejor imagen
        let imageUrl = 'https://placehold.co/200x200?text=Sin+Imagen';
        if (item.images && item.images.length > 0) {
            imageUrl = item.images[0].imageUrl;
        }

        // Formatear precio
        let price = "Consultar";
        if (seller && seller.commertialOffer && seller.commertialOffer.Price) {
            price = `$${seller.commertialOffer.Price.toLocaleString('es-AR')}`;
        }

        // Construir link al producto
        const productLink = p.linkText ? `https://${VTEX_ACCOUNT}.myvtex.com/${p.linkText}/p` : '#';

        return {
            id: p.productId,
            name: p.productName,
            img: imageUrl,
            price: price,
            link: productLink
        };
    }).filter(p => p !== null); // Eliminar nulos

    // Eliminar duplicados (por si buscamos términos similares)
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    // Respuesta al Frontend
    res.status(200).json({
      reply: `Busqué productos para: **${searchTerms.join(", ")}**. Aquí tienes las mejores opciones:`,
      products: uniqueProducts
    });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: 'Error interno conectando con IA o VTEX' });
  }
}
