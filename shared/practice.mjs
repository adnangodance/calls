export const MAX_CALL_SECONDS = 300;

export const practiceScenarios = [
  { id: 'introduction', title: 'Make your introduction', subtitle: 'Start a conversation with a busy office manager.', role: 'Office manager', name: 'Sarah', brief: 'The office has a full schedule and only a moment to talk. Introduce yourself and ask permission to continue.', goal: 'Discover one need and agree on a clear next step.', checklist: ['Introduce yourself and ask permission', 'Ask an open question about their workflow', 'Agree on a specific next step'] },
  { id: 'objection', title: 'Handle an objection', subtitle: 'Work through “We already have a partner.”', role: 'Practice manager', name: 'Jordan', brief: 'The practice already works with a partner. Acknowledge that relationship and ask where there may still be gaps.', goal: 'Understand the concern before offering a solution.', checklist: ['Acknowledge the existing relationship', 'Explore a gap without criticizing their partner', 'Connect the next step to their concern'] },
  { id: 'follow-up', title: 'Earn the next conversation', subtitle: 'Respond to “Just send me an email.”', role: 'Front desk coordinator', name: 'Alex', brief: 'The coordinator asks you to email some information. Make the follow-up relevant and find the right person to speak with.', goal: 'Ask a useful question and agree on a specific follow-up.', checklist: ['Respect the request for an email', 'Identify the right person and a relevant need', 'Confirm what to send and when to follow up'] },
];

export const feedbackCriteria = ['Opening', 'Discovery', 'Listening', 'Next step'];

export function validFeedback(value) {
  return Boolean(value && typeof value.summary === 'string' && value.summary.length <= 2000
    && typeof value.nextAttempt === 'string' && value.nextAttempt.length <= 2000
    && Array.isArray(value.criteria) && value.criteria.length === feedbackCriteria.length
    && value.criteria.every((item, index) => item && item.name === feedbackCriteria[index]
      && Number.isInteger(item.score) && item.score >= 0 && item.score <= 5
      && typeof item.evidence === 'string' && item.evidence.length <= 2000));
}
