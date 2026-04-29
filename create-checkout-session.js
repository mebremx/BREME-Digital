// =============================================================================
// BREME Digital — Stripe Checkout Session
// Endpoint: POST /api/create-checkout-session
//
// Reglas:
//   • TODOS los productos son PAGO ÚNICO (mode: 'payment').
//   • El mantenimiento NO es suscripción de Stripe; se vende como pago
//     único de "30 días de servicio". Si el cliente quiere renovar,
//     vuelve a pagar manualmente.
//   • Sin recurring, sin subscription, sin Payment Links.
//
// Recibe: { items: [{ id: string, quantity: number }, ...] }
// Devuelve: { url: string }  (redirige al Checkout de Stripe)
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY   (obligatoria)  → sk_live_... o sk_test_...
//   DOMAIN_URL          (opcional)     → default: https://bremedigital.com
// =============================================================================

const Stripe = require('stripe');

// ── Catálogo (fuente de verdad, en CENTAVOS) ─────────────────────────────────
// El cliente solo manda { id, quantity }; los precios NUNCA se aceptan
// desde el cliente. Validación 100% server-side.
const PRODUCTS = {
  web: {
    name: 'Web Presencia',
    price: 499900,        // $4,999.00 MXN
  },
  tienda: {
    name: 'Tienda Digital',
    price: 799900,        // $7,999.00 MXN
  },
  mant_web: {
    name: 'Mantenimiento Web — 30 días',
    price: 49900,         // $499.00 MXN
  },
  mant_tienda: {
    name: 'Mantenimiento Tienda — 30 días',
    price: 79900,         // $799.00 MXN
  },
};

module.exports = async (req, res) => {
  // ── CORS / método ─────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Validar configuración ─────────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[BREME] Falta STRIPE_SECRET_KEY en el entorno');
    return res.status(500).json({ error: 'Stripe no está configurado' });
  }
  const stripe = Stripe(stripeKey);

  const DOMAIN_URL = process.env.DOMAIN_URL || 'https://bremedigital.com';

  // ── Parsear body ──────────────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'JSON inválido' });
    }
  }
  body = body || {};

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'El carrito está vacío' });
  }

  // ── Validar cada item y construir TODOS los line_items ────────────────────
  // (Se mandan TODOS al checkout; nunca solo el primero.)
  const line_items = [];
  for (const item of items) {
    const product = PRODUCTS[item && item.id];
    if (!product) {
      return res.status(400).json({ error: `Producto desconocido: ${item && item.id}` });
    }

    const qty = parseInt(item.quantity, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: `Cantidad inválida para ${item.id}` });
    }

    line_items.push({
      price_data: {
        currency: 'mxn',
        product_data: { name: product.name },
        unit_amount: product.price,
      },
      quantity: qty,
    });
  }

  // ── Crear la sesión SIEMPRE en mode: 'payment' ────────────────────────────
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      success_url: `${DOMAIN_URL}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN_URL}/?canceled=true`,
      locale: 'es',
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[BREME] Stripe error:', err);
    return res.status(500).json({
      error: err.message || 'No se pudo crear la sesión de pago',
    });
  }
};
