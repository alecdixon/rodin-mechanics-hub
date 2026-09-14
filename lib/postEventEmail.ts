export const POST_EVENT_DEFAULT_RECIPIENTS = [
  "dan.crain@rodinmotorsport.com",
  "jimmy@rodinmotorsport.com",
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAdditionalRecipients(value: string) {
  const entries = value
    .split(/[;,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return {
    recipients: [...new Set(entries.filter((entry) => EMAIL_PATTERN.test(entry)))],
    invalid: [...new Set(entries.filter((entry) => !EMAIL_PATTERN.test(entry)))],
  };
}

export function buildPostEventRecipients(additionalRecipients: string[]) {
  const recipients = [
    ...POST_EVENT_DEFAULT_RECIPIENTS,
    ...additionalRecipients.map((entry) => entry.trim().toLowerCase()),
  ];

  return [...new Set(recipients.filter((entry) => EMAIL_PATTERN.test(entry)))];
}
