import OpenAI from 'openai';

// ==========================================
// CONFIGURACIÓN
// ==========================================
// Asegúrate de que tu package.json en Vercel tenga "engines": { "node": "18.x" } o superior
const MODELO_ID = "google/gemini-2.0-flash-exp"; // O el que prefieras de OpenRouter
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app",
    "X-Title": "Personal Shopper VTEX",
  }
});

// ==========================================
// CORS WRAPPER (Mejorado)
// ==========================================
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  // IMPORTANTE: En producción con Dynamic Yield, intenta poner '*' o el dominio específico de Carrefour
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
}

// ==========================================
// HANDLER PRINCIPAL
// ==========================================
const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  // IMPORTANTE: Para Carrefour Francia, la cuenta suele ser "carrefourfr" o "carrefour"
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT || "carrefourfr"; 

  console.log("1. Recibido mensaje:", message);

  try {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("Falta OPENROUTER_API_KEY");

    // A. Consultar a la IA (Estructura mejorada)
    const completion = await openai.chat.completions.create({
      model: MODELO_ID, 
      messages: [
        {
          role: "system",
          content: `Eres un Personal Shopper experto de Carrefour.
          Tu objetivo es ayudar al usuario con recetas, consejos y encontrar productos.
          
          OUTPUT ESPERADO: Un JSON puro con esta estructura:
          {
            "assistant_reply": "Texto con la respuesta amigable, la receta paso a paso o el consejo.",
            "search_terms": ["producto1", "producto2", "producto3"]
          }

          REGLAS:
          1. Si piden receta, pon los pasos en "assistant_reply" y los ingredientes genéricos en "search_terms".
          2. Si piden un producto suelto, pon algo breve en "assistant_reply" y el producto en "search_terms".
          3. "search_terms" debe ser un Array de Strings.
          4. NO uses Markdown en el JSON. Solo responde el JSON.`
        },
        { role: "user", content: message }
      ],
      response_format: { type: "json_object" } // Fuerza JSON si el modelo lo soporta
    });

    const textResponse = completion.choices[0].message.content;
    console.log("2. Respuesta IA:", textResponse);

    let parsedResponse = { assistant_reply: "", search_terms: [] };
    
    try {
        // Intento de parseo directo
        parsedResponse = JSON.parse(textResponse);
    } catch (e) {
        // Fallback: búsqueda manual de JSON
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsedResponse = JSON.parse(jsonMatch[0]);
        } else {
            parsedResponse = { 
                assistant_reply: textResponse, 
                search_terms: [message] 
            };
        }
    }

    const { assistant_reply, search_terms } = parsedResponse;

    // B. Buscar en VTEX (Paralelo)
    console.log("3. Buscando en VTEX:", search_terms);
    
    const productPromises = search_terms.map(async (term) => {
      // Usamos el endpoint standard. OJO: Carrefour puede tener seguridad extra.
      // Prueba cambiando 'vtexcommercestable.com.br' por 'myvtex.com' si falla.
      const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=2`;
      
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) {
            console.error(`Error VTEX ${term}:`, response.status);
            return [];
        }
        return await response.json();
      } catch (err) { 
        console.error(`Fetch Error VTEX ${term}:`, err);
        return []; 
      }
    });

    const rawResults = await Promise.all(productPromises);

    // C. Formatear Productos
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        
        const item = p.items[0];
        const seller = item.sellers.find(s => s.commertialOffer.AvailableQuantity > 0) || item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images && item.images.length > 0 ? item.images[0].imageUrl : '',
            price: seller ? `${seller.commertialOffer.Price.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}` : "Voir Prix",
            link: p.linkText ? `https://www.carrefour.fr/p/${p.linkText}` : '#' // Ajustado para Carrefour
        };
    }).filter(p => p !== null);

    // Eliminar duplicados
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    // D. Responder al Frontend
    res.status(200).json({
      reply: assistant_reply || "Aquí tienes los productos:",
      products: uniqueProducts
    });

  } catch (error) {
    console.error("CRITICAL SERVER ERROR:", error);
    // Devolvemos el error detallado para que sepas qué pasa (quítalo en producción real)
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}

export default allowCors(handler);
