export const MAX_CALL_SECONDS = 20;
export const CALL_CONNECTION_SECONDS = 45;
export const CALL_TRANSCRIPT_GRACE_SECONDS = 3;

export const practiceScenarios = [
  { id: 'introduction', title: 'Make your introduction', subtitle: 'Start a conversation with a busy office manager.', role: 'Office manager', name: 'Sarah', brief: 'The office has a full schedule and only a moment to talk. Introduce yourself and ask permission to continue.', goal: 'Discover one need and agree on a clear next step.', checklist: ['Introduce yourself and ask permission', 'Ask an open question about their workflow', 'Agree on a specific next step'] },
  { id: 'objection', title: 'Handle an objection', subtitle: 'Work through “We already have a partner.”', role: 'Practice manager', name: 'Jordan', brief: 'The practice already works with a partner. Acknowledge that relationship and ask where there may still be gaps.', goal: 'Understand the concern before offering a solution.', checklist: ['Acknowledge the existing relationship', 'Explore a gap without criticizing their partner', 'Connect the next step to their concern'] },
  { id: 'follow-up', title: 'Earn the next conversation', subtitle: 'Respond to “Just send me an email.”', role: 'Front desk coordinator', name: 'Alex', brief: 'The coordinator asks you to email some information. Make the follow-up relevant and find the right person to speak with.', goal: 'Ask a useful question and agree on a specific follow-up.', checklist: ['Respect the request for an email', 'Identify the right person and a relevant need', 'Confirm what to send and when to follow up'] },
];

export const practiceLevels = [
  { number: 1, emoji: '👋', title: 'Break the ice', description: 'Make a clear introduction and find one useful next step.', callsRequired: 10, scenario: 'introduction' },
  { number: 2, emoji: '🤝', title: 'Build trust', description: 'Listen to a concern and keep the conversation moving.', callsRequired: 20, scenario: 'objection' },
  { number: 3, emoji: '🎯', title: 'Make it count', description: 'Reach the right person and earn a specific follow-up.', callsRequired: 50, scenario: 'follow-up' },
];

// Fictional company, partner and specialty for each call in a level.
// Keep existing IDs and the order within each level stable for saved progress and extensions.
const companiesByLevel = [
  [
    ['cedar', 'Cedar Family Care', 'Sarah', 'Family medicine'],
    ['willow', 'Willow Health', 'Maya', 'Primary care'],
    ['brookside', 'Brookside Clinic', 'Ben', 'Community clinic'],
    ['birchway', 'Birchway Medical', 'Emma', 'Internal medicine'],
    ['meadowbrook', 'Meadowbrook Pediatrics', 'Noah', 'Pediatrics'],
    ['pinecrest', 'Pinecrest Family Health', 'Olivia', 'Family medicine'],
    ['riverbend', 'Riverbend Wellness', 'Liam', 'Outpatient care'],
    ['elmwood', 'Elmwood Primary Care', 'Ava', 'Primary care'],
    ['cloverhill', 'Clover Hill Clinic', 'Ethan', 'Community clinic'],
    ['aspen', 'Aspen Grove Health', 'Sofia', 'Family medicine'],
  ],
  [
    ['northstar', 'Northstar Medical', 'Jordan', 'Internal medicine'],
    ['maple', 'Maple Grove Care', 'Sam', 'Family medicine'],
    ['harbor', 'Harbor Wellness', 'Riley', 'Outpatient care'],
    ['stonebridge', 'Stonebridge Dermatology', 'Chloe', 'Dermatology'],
    ['silverleaf', 'Silverleaf Cardiology', 'Lucas', 'Cardiology'],
    ['crestwood', 'Crestwood Pediatrics', 'Grace', 'Pediatrics'],
    ['fairhaven', 'Fairhaven Family Clinic', 'Daniel', 'Family medicine'],
    ['clearwater', 'Clearwater Orthopedics', 'Zoe', 'Orthopedics'],
    ['redwood', 'Redwood Internal Medicine', 'Henry', 'Internal medicine'],
    ['larkspur', 'Larkspur Wellness', 'Nora', 'Outpatient care'],
    ['westgrove', 'Westgrove Medical', 'Leo', 'Primary care'],
    ['foxglove', 'Foxglove Family Care', 'Isla', 'Family medicine'],
    ['lakehaven', 'Lakehaven Clinic', 'Owen', 'Community clinic'],
    ['orchard', 'Orchard View Health', 'Mia', 'Primary care'],
    ['greenfield', 'Greenfield Pediatrics', 'Jack', 'Pediatrics'],
    ['briarwood', 'Briarwood Medical', 'Ella', 'Internal medicine'],
    ['seabrook', 'Seabrook Specialty Care', 'Miles', 'Multi-specialty practice'],
    ['hollyridge', 'Holly Ridge Clinic', 'Amelia', 'Community clinic'],
    ['copperhill', 'Copper Hill Health', 'Finn', 'Family medicine'],
    ['springvale', 'Springvale Care Group', 'Layla', 'Primary care network'],
  ],
  [
    ['summit', 'Summit Health Group', 'Alex', 'Multi-specialty practice'],
    ['evergreen', 'Evergreen Medical', 'Jamie', 'Primary care network'],
    ['oakwell', 'Oakwell Partners', 'Taylor', 'Independent practice'],
    ['brightwater', 'Brightwater Health', 'Casey', 'Primary care network'],
    ['cedarstone', 'Cedarstone Medical Group', 'Morgan', 'Multi-specialty practice'],
    ['juniper', 'Juniper Family Partners', 'Avery', 'Family medicine'],
    ['bluebird', 'Bluebird Pediatrics', 'Quinn', 'Pediatrics'],
    ['windermere', 'Windermere Cardiology', 'Drew', 'Cardiology'],
    ['rosewood', 'Rosewood Dermatology', 'Cameron', 'Dermatology'],
    ['hawthorne', 'Hawthorne Orthopedics', 'Blake', 'Orthopedics'],
    ['parkstone', 'Parkstone Health Group', 'Reese', 'Primary care network'],
    ['meadowgate', 'Meadowgate Medical', 'Parker', 'Internal medicine'],
    ['ridgeview', 'Ridgeview Specialty Care', 'Rowan', 'Multi-specialty practice'],
    ['sunnymere', 'Sunnymere Family Clinic', 'Harper', 'Family medicine'],
    ['elmbridge', 'Elmbridge Care Partners', 'Logan', 'Independent practice'],
    ['brookhaven', 'Brookhaven Wellness', 'Sage', 'Outpatient care'],
    ['valewood', 'Valewood Medical', 'Emerson', 'Internal medicine'],
    ['oakmeadow', 'Oakmeadow Pediatrics', 'Dakota', 'Pediatrics'],
    ['silverbirch', 'Silver Birch Health', 'Finley', 'Primary care'],
    ['cedarhaven', 'Cedarhaven Partners', 'Skyler', 'Independent practice'],
    ['pinehaven', 'Pinehaven Medical Group', 'Robin', 'Multi-specialty practice'],
    ['maplebrook', 'Maplebrook Family Care', 'Charlie', 'Family medicine'],
    ['willowbend', 'Willowbend Cardiology', 'Hayden', 'Cardiology'],
    ['aspenridge', 'Aspen Ridge Dermatology', 'Jesse', 'Dermatology'],
    ['stonehaven', 'Stonehaven Orthopedics', 'Kendall', 'Orthopedics'],
    ['riverstone', 'Riverstone Health Network', 'Elliot', 'Primary care network'],
    ['cloverfield', 'Cloverfield Clinic', 'Sydney', 'Community clinic'],
    ['birchcrest', 'Birchcrest Medical', 'Marley', 'Internal medicine'],
    ['fernwood', 'Fernwood Care Group', 'River', 'Multi-specialty practice'],
    ['heathermoor', 'Heathermoor Wellness', 'Bailey', 'Outpatient care'],
    ['lakewood', 'Lakewood Family Partners', 'Arden', 'Family medicine'],
    ['foxridge', 'Foxridge Pediatrics', 'Frankie', 'Pediatrics'],
    ['mistybrook', 'Mistybrook Medical', 'Remy', 'Primary care'],
    ['goldenleaf', 'Goldenleaf Health Group', 'Toby', 'Multi-specialty practice'],
    ['westhaven', 'Westhaven Clinic', 'Ali', 'Community clinic'],
    ['northmeadow', 'Northmeadow Care Partners', 'Shay', 'Independent practice'],
    ['eastbrook', 'Eastbrook Cardiology', 'Ellis', 'Cardiology'],
    ['southgrove', 'Southgrove Dermatology', 'Lane', 'Dermatology'],
    ['pineridge', 'Pine Ridge Orthopedics', 'Cory', 'Orthopedics'],
    ['hollybrook', 'Hollybrook Medical Group', 'Devin', 'Internal medicine'],
    ['linden', 'Linden Family Health', 'Kelly', 'Family medicine'],
    ['wrenfield', 'Wrenfield Pediatrics', 'Andy', 'Pediatrics'],
    ['greystone', 'Greystone Wellness', 'Lee', 'Outpatient care'],
    ['rosehill', 'Rosehill Health Partners', 'Jess', 'Independent practice'],
    ['fairmeadow', 'Fairmeadow Clinic', 'Dylan', 'Community clinic'],
    ['clearbrook', 'Clearbrook Medical', 'Addison', 'Internal medicine'],
    ['brookfield', 'Brookfield Care Network', 'Kris', 'Primary care network'],
    ['oakridge', 'Oakridge Specialty Group', 'Rory', 'Multi-specialty practice'],
    ['magnolia', 'Magnolia Family Partners', 'Erin', 'Family medicine'],
    ['highgrove', 'Highgrove Health Group', 'Ashley', 'Primary care network'],
  ],
];

// Synthetic directory details for the roleplay. Websites use the reserved
// .example domain; extensions route only to AI partners, never telephone numbers.
const practiceLocations = ['Chicago, IL 60601', 'Austin, TX 78701', 'Denver, CO 80202', 'Portland, OR 97205', 'Raleigh, NC 27601'];
export const practiceContacts = companiesByLevel.flatMap((companies, levelIndex) => {
  const level = practiceLevels[levelIndex];
  return companies.map(([id, company, name, specialty], index) => ({
    id, company, name, specialty,
    initials: company.split(' ').slice(0, 2).map(word => word[0]).join(''),
    extension: String(level.number * 100 + index + 1),
    address: `${120 + levelIndex * 200 + index * 12} ${company.split(' ')[0]} Lane`,
    locality: practiceLocations[(index + levelIndex) % practiceLocations.length],
    website: `${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
    level: level.number, scenario: level.scenario,
  }));
});

export const feedbackCriteria = ['Opening', 'Discovery', 'Listening', 'Next step'];

export function validFeedback(value) {
  return Boolean(value && typeof value.summary === 'string' && value.summary.length <= 2000
    && typeof value.nextAttempt === 'string' && value.nextAttempt.length <= 2000
    && Array.isArray(value.criteria) && value.criteria.length === feedbackCriteria.length
    && value.criteria.every((item, index) => item && item.name === feedbackCriteria[index]
      && Number.isInteger(item.score) && item.score >= 0 && item.score <= 5
      && typeof item.evidence === 'string' && item.evidence.length <= 2000));
}
