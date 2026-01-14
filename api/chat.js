import OpenAI from 'openai';

// ==========================================
// CONFIGURACIÓN
// ==========================================
const MODELO_ID = "google/gemini-2.0-flash-exp"; 

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://personal-shopper.vercel.app",
    "X-Title": "Personal Shopper VTEX AR",
  }
});

// ==========================================
// CORS WRAPPER
// ==========================================
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
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
  // 🇦🇷 CUENTA DE ARGENTINA
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT || "carrefourar"; 

  try {
    // A. Consultar a la IA
    const completion = await openai.chat.completions.create({
      model: MODELO_ID, 
      messages: [
        {
          role: "system",
          content: `Eres un Asistente Virtual experto de Carrefour Argentina.
          Tu objetivo es ayudar al usuario con recetas, consejos y encontrar productos en el catálogo.
          Habla en español neutro o rioplatense (Argentina), sé amable y servicial.
          
          OUTPUT ESPERADO: Un JSON puro con esta estructura:
          {
            "assistant_reply": "Texto con la respuesta, receta o consejo.",
            "search_terms": ["producto1", "producto2", "producto3"]
          }

          REGLAS:
          1. Si piden receta, pon los pasos en "assistant_reply" y los ingredientes básicos en "search_terms".
          2. Si piden un producto suelto, responde brevemente y ponlo en "search_terms".
          3. "search_terms" debe ser un Array de Strings en ESPAÑOL.
          4. NO uses Markdown en el JSON.`
        },
        { role: "user", content: message }
      ],
      response_format: { type: "json_object" }
    });

    const textResponse = completion.choices[0].message.content;
    let parsedResponse = { assistant_reply: "", search_terms: [] };
    
    try {
        parsedResponse = JSON.parse(textResponse);
    } catch (e) {
        // Fallback simple
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedResponse = JSON.parse(jsonMatch[0]);
        else parsedResponse = { assistant_reply: textResponse, search_terms: [message] };
    }

    const { assistant_reply, search_terms } = parsedResponse;

    // B. Buscar en VTEX Argentina
    const productPromises = search_terms.map(async (term) => {
      // Endpoint standard de VTEX
      const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=3`;
      
      try {
        const response = await fetch(vtexUrl);
        if (!response.ok) return [];
        return await response.json();
      } catch (err) { 
        return []; 
      }
    });

    const rawResults = await Promise.all(productPromises);

    // C. Formatear Productos
    const products = rawResults.flat().map(p => {
        if (!p || !p.items || p.items.length === 0) return null;
        
        const item = p.items[0];
        // Buscar stock disponible
        const seller = item.sellers.find(s => s.commertialOffer.AvailableQuantity > 0) || item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images && item.images.length > 0 ? item.images[0].imageUrl : '',
            // 🇦🇷 Formato Pesos Argentinos
            price: seller ? seller.commertialOffer.Price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }) : "Ver Precio",
            // 🇦🇷 Link a Carrefour AR
            link: p.linkText ? `https://www.carrefour.com.ar/${p.linkText}/p` : '#'
        };
    }).filter(p => p !== null);

    // Eliminar duplicados
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    res.status(200).json({
      reply: assistant_reply || "Acá tenés los productos que encontré:",
      products: uniqueProducts
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
}

export default allowCors(handler);
