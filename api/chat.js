import OpenAI from 'openai';

// ==========================================
// CONFIGURACIÓN
// ==========================================
// Usamos el modelo experimental gratuito para velocidad y costo cero
const MODELO_ID = "google/gemini-2.0-flash-exp:free"; 

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
  const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT || "carrefourar"; 

  try {
    // ---------------------------------------------------------
    // A. Consultar a la IA (Prompt de Ingeniería Avanzada)
    // ---------------------------------------------------------
    const completion = await openai.chat.completions.create({
      model: MODELO_ID, 
      messages: [
        {
          role: "system",
          content: `Eres un Asistente Experto de Carrefour Argentina (Personal Shopper).
          
          OBJETIVOS:
          1. Interpretar la intención del usuario (Receta, búsqueda suelta, consejo).
          2. Generar términos de búsqueda PRECISOS para un supermercado.
          
          REGLAS DE RESPUESTA (JSON):
          {
            "assistant_reply": "Texto formateado con HTML básico (<br> para saltos, <b> para negrita). Si es receta: Título, Ingredientes con cantidades, Pasos numerados y Tiempo estimado.",
            "search_terms": ["termino_especifico_1", "termino_especifico_2"]
          }

          REGLAS DE BÚSQUEDA (CRÍTICO):
          - Sé ESPECÍFICO para evitar errores. No busques "leche" (trae chocolatada), busca "leche entera sachet" o "leche larga vida".
          - No busques "arroz", busca "arroz largo fino" o "arroz doble carolina".
          - Si piden una receta, desglosa TODOS los ingredientes necesarios en la lista.
          
          TONO:
          - Servicial, experto, argentino rioplatense pero profesional.`
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
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedResponse = JSON.parse(jsonMatch[0]);
        else parsedResponse = { assistant_reply: textResponse, search_terms: [message] };
    }

    const { assistant_reply, search_terms } = parsedResponse;

    // ---------------------------------------------------------
    // B. Buscar en VTEX (Lógica de Negocio Aplicada)
    // ---------------------------------------------------------
    
    // Función para buscar y filtrar "El Mejor Candidato"
    const fetchBestProduct = async (term) => {
        // Buscamos 5 opciones para tener de dónde elegir
        const vtexUrl = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=4`;
        
        try {
            const response = await fetch(vtexUrl);
            if (!response.ok) return null;
            const data = await response.json();
            if (!data || data.length === 0) return null;

            // --- ALGORITMO DE SELECCIÓN ---
            // 1. Prioridad: Marca Carrefour
            // 2. Prioridad: Disponibilidad
            
            const candidates = data.map(p => {
                const item = p.items[0];
                const seller = item.sellers.find(s => s.commertialOffer.AvailableQuantity > 0);
                if (!seller) return null; // Sin stock

                return {
                    raw: p,
                    isCarrefour: p.productName.toLowerCase().includes('carrefour'),
                    price: seller.commertialOffer.Price
                };
            }).filter(c => c !== null);

            if (candidates.length === 0) return null;

            // Ordenamos: Primero los que son marca Carrefour, luego por precio (opcional)
            candidates.sort((a, b) => {
                if (a.isCarrefour && !b.isCarrefour) return -1; // A va primero
                if (!a.isCarrefour && b.isCarrefour) return 1;  // B va primero
                return 0; // Si ambos son o no son Carrefour, da igual (o podés ordenar por precio)
            });

            // Devolvemos SOLO EL GANADOR (El primero de la lista ordenada)
            return candidates[0].raw;

        } catch (err) {
            console.error(`Error buscando ${term}:`, err);
            return null;
        }
    };

    // Ejecutamos las búsquedas en paralelo
    const productPromises = search_terms.map(term => fetchBestProduct(term));
    const rawResults = await Promise.all(productPromises);

    // ---------------------------------------------------------
    // C. Formatear para el Frontend
    // ---------------------------------------------------------
    const products = rawResults.filter(p => p !== null).map(p => {
        const item = p.items[0];
        const seller = item.sellers.find(s => s.commertialOffer.AvailableQuantity > 0) || item.sellers[0];

        return {
            id: p.productId,
            name: p.productName,
            img: item.images && item.images.length > 0 ? item.images[0].imageUrl : '',
            price: seller ? seller.commertialOffer.Price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }) : "Ver Precio",
            link: p.linkText ? `https://www.carrefour.com.ar/${p.linkText}/p` : '#'
        };
    });

    // Eliminar duplicados por si la IA repitió términos con distintos nombres
    const uniqueProducts = Array.from(new Map(products.map(item => [item.id, item])).values());

    res.status(200).json({
      reply: assistant_reply || "Aquí tienes los productos recomendados:",
      products: uniqueProducts
    });

  } catch (error) {
    console.error("CRITICAL SERVER ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}

export default allowCors(handler);
