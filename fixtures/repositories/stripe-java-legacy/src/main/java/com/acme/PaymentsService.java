package com.acme.payments;

import com.stripe.Stripe;
import com.stripe.model.PaymentIntent;
import com.stripe.param.PaymentIntentCreateParams;
import com.google.gson.Gson;

public class PaymentsService {

    private final Gson gson = new Gson();

    public PaymentIntent createPaymentIntent(long amount, String currency) {
        Stripe.apiKey = System.getenv("STRIPE_SECRET_KEY");

        PaymentIntentCreateParams params =
            PaymentIntentCreateParams.builder()
                .setAmount(amount)
                .setCurrency(currency)
                .build();

        return PaymentIntent.create(params);
    }

    public String serialize(PaymentIntent intent) {
        return gson.toJson(intent);
    }
}
