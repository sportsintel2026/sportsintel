const Stripe = require("stripe");
const { supabase } = require("../middleware/auth");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Price IDs (create these in Stripe dashboard) ──────────────────────────────
const PRICES = {
  pro_monthly:   process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  pro_yearly:    process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  elite_monthly: process.env.STRIPE_ELITE_MONTHLY_PRICE_ID,
  elite_yearly:  process.env.STRIPE_ELITE_YEARLY_PRICE_ID,
};

// Create or retrieve Stripe customer for a user
async function getOrCreateCustomer(userId, email) {
  // Check if customer already exists
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (sub?.stripe_customer_id) {
    return sub.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  // Store customer ID
  await supabase.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: customer.id,
    tier: "free",
    status: "active",
  }, { onConflict: "user_id" });

  return customer.id;
}

// Create Stripe Checkout session
async function createCheckoutSession({ userId, email, priceKey, successUrl, cancelUrl }) {
  const customerId = await getOrCreateCustomer(userId, email);
  const priceId = PRICES[priceKey];

  if (!priceId) throw new Error(`Invalid price key: ${priceKey}`);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { supabase_user_id: userId },
    },
    allow_promotion_codes: true,
  });

  return session;
}

// Create billing portal session (manage/cancel subscription)
async function createPortalSession(userId, returnUrl) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (!sub?.stripe_customer_id) {
    throw new Error("No billing account found");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}

// Handle Stripe webhook events
async function handleWebhookEvent(event) {
  switch (event.type) {

    case "checkout.session.completed": {
      const session = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const userId = subscription.metadata.supabase_user_id;
      const priceId = subscription.items.data[0].price.id;
      const tier = getTierFromPriceId(priceId);

      await supabase.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: subscription.id,
        tier,
        status: "active",
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      console.log(`[Stripe] User ${userId} subscribed to ${tier}`);
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.supabase_user_id;

      await supabase.from("subscriptions")
        .update({
          status: "active",
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = subscription.metadata.supabase_user_id;

      await supabase.from("subscriptions")
        .update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const userId = subscription.metadata.supabase_user_id;

      await supabase.from("subscriptions")
        .update({ tier: "free", status: "canceled", updated_at: new Date().toISOString() })
        .eq("user_id", userId);

      console.log(`[Stripe] User ${userId} subscription canceled`);
      break;
    }
  }
}

function getTierFromPriceId(priceId) {
  if (priceId === PRICES.elite_monthly || priceId === PRICES.elite_yearly) return "elite";
  if (priceId === PRICES.pro_monthly || priceId === PRICES.pro_yearly) return "pro";
  return "free";
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  stripe,
};
