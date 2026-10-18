export interface SendInvitationEmailParams {
  toEmail: string;
  familyName: string;
  inviterEmail: string;
  rawToken: string;
}

export interface EmailServiceResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

export class EmailDeliveryError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "EmailDeliveryError";
    this.statusCode = statusCode;
  }
}

export const emailService = {
  /**
   * Dispatches an invitation email using Brevo's REST API.
   * Uses Node's built-in fetch without installing external packages.
   * If BREVO_API_KEY is not configured, explicitly returns an error / throws
   * so that the caller never falsely reports that an email was delivered.
   */
  async sendInvitationEmail(params: SendInvitationEmailParams): Promise<EmailServiceResult> {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || "Family Rummy Tracker";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    if (!apiKey || !senderEmail) {
      throw new EmailDeliveryError(
        503,
        "Email delivery provider is not configured. Invitation could not be sent."
      );
    }

    const inviteLink = `${frontendUrl}/invite/accept?token=${encodeURIComponent(params.rawToken)}`;

    const payload = {
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: params.toEmail,
        },
      ],
      subject: `You've been invited to join the ${params.familyName} family on Family Rummy Tracker`,
      htmlContent: `
        <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
          <h2>Family Rummy Tracker Invitation</h2>
          <p>${params.inviterEmail} has invited you to join the <strong>${params.familyName}</strong> family group.</p>
          <p>Click the link below to accept the invitation and join:</p>
          <p style="margin: 24px 0;">
            <a href="${inviteLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Accept Invitation</a>
          </p>
          <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:<br /><code>${inviteLink}</code></p>
          <p style="font-size: 12px; color: #999; margin-top: 32px;">This invitation will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
        </div>
      `,
    };

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Brevo API error response status:", response.status, "body:", errorText);
        throw new EmailDeliveryError(
          502,
          "Failed to send invitation email through email delivery service"
        );
      }

      const data = (await response.json()) as { messageId?: string };
      return {
        sent: true,
        messageId: data.messageId,
      };
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        throw error;
      }
      console.error("Unexpected error contacting email provider:", error instanceof Error ? error.message : "Unknown");
      throw new EmailDeliveryError(
        502,
        "Failed to deliver invitation email"
      );
    }
  },
};
