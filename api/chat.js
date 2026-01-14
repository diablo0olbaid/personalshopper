import OpenAI from 'openai';

// ==========================================
// 1. CONFIGURACIÓN DEL MODELO (VERIFICADO ✅)
// ==========================================
// Usamos el ID exacto obtenido de la lista oficial:
const MODELO_ID = "google/gemini-3-flash-preview"; 

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app",
    "X-Title": "Personal Shopper VTEX",
  }
});

// ==========================================
// 2. WRAPPER PARA CORS (EVITA ERRORES DE RED)
// ==========================================
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  
  // Si es un chequeo del navegador (OPTIONS), respondemos OK y cortamos.
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Ejecutamos la lógica real
  return await fn(req, res);
}

// ==========================================
// 3. LÓGICA DEL CHAT
// ==========================================
const handler = async (req, res) => {
  // Solo aceptamos peticiones POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; 

  try {
    // A. Consultar a la IA
    const completion = await openai.chat.completions.create({
      model: MODELO_ID, 
      messages: [
        {
          role: "system",
          content: `Eres un asistente experto en compras para un supermercado.
          Tu trabajo es interpretar lo que pide el usuario y generar una lista de TÉRMINOS DE BÚSQUEDA para el catálogo.
          
          REGLAS:
          1. Analiza el mensaje: "${message}"
          2. Genera un JSON Array con los productos a buscar.
          3. Ejemplo: "Ingredientes para torta" -> ["harina", "huevos", "leche", "azucar"]
          4. Responde ÚNICAMENTE el JSON. Nada de texto extra.`
        },
        { role: "user", content: message }
      ],
    });

    // B. Limpiar respuesta de la IA (por si manda texto extra)
    let searchTerms = [];
    try {
      const textResponse = completion.choices[0].message.content;
      // Buscamos donde empieza y termina el JSON (corchetes)
      const jsonStart = textResponse.indexOf('[');
      const jsonEnd = textResponse.lastIndexOf(']') + 1;
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonString = textResponse.substring(jsonStart, jsonEnd);
        searchTerms = JSON.parse(jsonString);
      } else {
        // Fallback si no hay JSON claro
        searchTerms = [message];
      }
    } catch (e) {
      console.error("Error parseando IA:", e);
      searchTerms = [message];
    }

    // C. Buscar en VTEX (Paralelo)
    const productPromises = searchTerms.map(async (term) => {
      // Usamos el endpoint de búsqueda pública
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

    // D. Formatear para el Frontend
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        
        const item = p.items[0];
        const seller = item.sellers[0]; // Tomamos el primer vendedor

        return {
            id: p.productId,
            name: p.productName,
            img: item.images && item.images.length > 0 ? item.images[0].imageUrl : '',
            price: seller ? `$${seller.commertialOffer.Price.toLocaleString('es-AR')}` : "Ver Precio",
            link: p.linkText ? `/${p.linkText}/p` : '#'
        };
    }).filter(p => p !== null);

    // Eliminar duplicados por ID
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    // E. Responder al Frontend
    res.status(200).json({
      reply: uniqueProducts.length > 0 
             ? `¡Listo! Busqué **${searchTerms.join(", ")}** y encontré estas opciones:` 
             : `Busqué **${searchTerms.join(", ")}** pero no encontré resultados exactos.`,
      products: uniqueProducts
    });

  } catch (error) {
    console.error("CRITICAL ERROR:", error);
    // Devolvemos el error en JSON para que el frontend no muestre "undefined"
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}

// Exportamos la función envuelta en el escudo CORS
export default allowCors(handler);
