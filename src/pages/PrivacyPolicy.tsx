import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Privacy Policy & Terms | Astraz</title>
        <meta name="description" content="Astraz privacy policy, refund & cancellation rules, auto-renewal terms, and how we handle your data and generated content." />
        <link rel="canonical" href="https://astraz.lovable.app/privacy-policy" />
        <meta property="og:title" content="Privacy Policy & Terms | Astraz" />
        <meta property="og:description" content="Astraz privacy policy, refund & cancellation rules, auto-renewal terms, and how we handle your data." />
        <meta property="og:url" content="https://astraz.lovable.app/privacy-policy" />
      </Helmet>
      <div className="aurora-bg" />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <h1 className="text-3xl font-display font-bold mb-2 xai-gradient-text">Privacy Policy & Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: February 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-display font-semibold">1. Introduction</h2>
            <p className="text-muted-foreground">
              Welcome to Astraz. By using our services, you agree to these terms and our privacy practices. 
              Please read them carefully before subscribing to any paid plan.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">2. Subscription Plans</h2>
            <p className="text-muted-foreground">Astraz offers the following subscription tiers:</p>
            <ul className="text-muted-foreground list-disc pl-5 space-y-1">
              <li><strong>Free</strong>: 5 low-quality images/day, no video, watermarks applied.</li>
              <li><strong>Basic (₦5,000/mo)</strong>: 10 medium-quality images/day, 2 low-quality videos/day, watermarks applied.</li>
              <li><strong>Pro (₦20,000/mo)</strong>: 25 high-quality images/day, 8 high-quality videos/day, no video watermarks.</li>
              <li><strong>Ultimate (₦50,000/mo)</strong>: Unlimited images & videos, any model, no watermarks.</li>
            </ul>
            <p className="text-muted-foreground">Yearly billing provides a 30% discount on all paid plans.</p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">3. Refund & Cancellation Policy</h2>
            <p className="text-muted-foreground">
              <strong>Monthly plans:</strong> Full refund if cancelled within 72 hours of purchase. 
              After 72 hours, a 20% cancellation fee is deducted from your refund.
            </p>
            <p className="text-muted-foreground">
              <strong>Yearly plans:</strong> Full refund if cancelled within 31 days of purchase. 
              After 31 days, a 20% cancellation fee is deducted from your refund.
            </p>
            <p className="text-muted-foreground">
              Upon cancellation, your subscription remains active until the end of the current billing period.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">4. Auto-Renewal</h2>
            <p className="text-muted-foreground">
              Subscriptions with auto-renewal enabled will automatically renew at the end of each billing cycle. 
              You will be notified via email before renewal. You can disable auto-renewal at any time from Account Settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">5. Data Collection & Usage</h2>
            <p className="text-muted-foreground">
              We collect your email, name, and usage data to provide our services. Generated images and videos 
              are stored securely. We do not sell your personal data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">6. Email Notifications</h2>
            <p className="text-muted-foreground">
              If you opt to save your payment method, you will receive email notifications for:
              subscription confirmations, upcoming renewals, payment receipts, and cancellation confirmations.
              You can manage notification preferences in your account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">7. Watermarks</h2>
            <p className="text-muted-foreground">
              All generated media on Free and Basic plans includes a 50% transparent Astraz watermark. 
              Pro users have no watermarks on videos but retain image watermarks. 
              Ultimate users have no watermarks on any media.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">8. Content Policy</h2>
            <p className="text-muted-foreground">
              Users are responsible for the content they generate. Astraz reserves the right to suspend accounts 
              that violate our content guidelines. Generated content should not be used for illegal, harmful, 
              or misleading purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-display font-semibold">9. Contact</h2>
            <p className="text-muted-foreground">
              For any questions regarding these terms, please contact us through the app or email support.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
