// api/chat.js
import OpenAI from 'openai';

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // La tomaremos de Vercel
});

// Configuración de VTEX (Variables de entorno)
const VTEX_ACCOUNT = process.env.VTEX_ACCOUNT; // ej: "carrefourar"
const VTEX_ENV = 'vtexcommercestable.com.br';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { message } = req.body;

  try {
    // 1. Preguntar a GPT-4 para obtener keywords de búsqueda
    // Usamos "Function Calling" simulado para que nos de JSON
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo", // O gpt-3.5-turbo
      messages: [
        {
          role: "system",
          content: `Eres un asistente de compras experto. Tu trabajo es interpretar lo que pide el usuario y traducirlo a TÉRMINOS DE BÚSQUEDA para un e-commerce.
          
          Si el usuario dice "quiero hacer un asado", tú debes devolver un JSON con una lista de términos como ["carne", "carbon", "chorizo"].
          Si el usuario pide un producto específico, devuelve ese término.
          
          Responde SOLO con el JSON puro, sin texto extra.`
        },
        { role: "user", content: message }
      ],
    });

    const gptResponse = completion.choices[0].message.content;
    let searchTerms = [];
    
    try {
        searchTerms = JSON.parse(gptResponse); // Convertimos la respuesta de IA a Array
    } catch (e) {
        searchTerms = [message]; // Fallback si falla el JSON
    }

    // 2. Buscar en VTEX Real (Hacemos las peticiones en paralelo)
    // Endpoint público de búsqueda de VTEX: /api/catalog_system/pub/products/search/{term}
    
    const productPromises = searchTerms.map(async (term) => {
        const vtexUrl = `https://${VTEX_ACCOUNT}.${VTEX_ENV}/api/catalog_system/pub/products/search/${encodeURIComponent(term)}?_from=0&_to=3`;
        
        const response = await fetch(vtexUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                // Si tu tienda es privada, necesitas agregar aquí los headers:
                // 'X-VTEX-API-AppKey': process.env.VTEX_KEY,
                // 'X-VTEX-API-AppToken': process.env.VTEX_TOKEN
            }
        });
        
        if (!response.ok) return [];
        return await response.json();
    });

    const results = await Promise.all(productPromises);
    
    // Aplanamos los resultados (VTEX devuelve arrays de arrays)
    const flatProducts = results.flat().filter(p => p != null);

    // 3. Formatear para el Frontend
    // VTEX devuelve un JSON gigante, solo queremos imagen, nombre y precio
    const formattedProducts = flatProducts.map(p => ({
        name: p.productName,
        img: p.items[0].images[0].imageUrl,
        price: p.items[0].sellers[0].commertialOffer.Price, // Precio real
        link: p.linkText
    }));

    // Enviamos respuesta al Frontend
    res.status(200).json({
        aiReply: `Busqué productos para: ${searchTerms.join(", ")}`,
        products: formattedProducts
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error conectando con la IA o VTEX' });
  }
}
