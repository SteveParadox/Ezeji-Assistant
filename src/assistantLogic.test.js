import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfflineFallbackReply as buildAssistantReply, buildAssistantRequestPayload } from './assistantLogic.js';

test('buildAssistantReply uses service details and prior context', () => {
  const profile = {
    business: 'Dreadlocks Studio',
    businessType: 'Salon & Beauty',
    serviceName: 'Dreadlocks',
    price: '$180',
    hours: 'Mon-Sat 9:00 AM - 6:00 PM',
    description: 'I specialize in dreadlocks, twists, and loc maintenance.'
  };

  const conversation = [
    { from: 'customer', text: 'Hi' },
    { from: 'ai', text: 'Hello' }
  ];

  const reply = buildAssistantReply('How much is dreadlocks?', profile, conversation);

  assert.match(reply, /Dreadlocks/i);
  assert.match(reply, /\$180/i);
  assert.match(reply, /dreadlocks|loc maintenance/i);
});

test('buildAssistantReply greets like a real assistant for a new client', () => {
  const profile = {
    business: 'Bloom & Co. Salon',
    businessType: 'Salon & Beauty',
    serviceName: 'Hair styling',
    price: '$120',
    hours: 'Mon-Sat 9:00 AM - 6:00 PM',
    description: 'We create polished, modern looks for busy clients.'
  };

  const reply = buildAssistantReply('hi there', profile, []);

  assert.match(reply, /hi|hello/i);
  assert.match(reply, /Bloom & Co\. Salon/i);
  assert.match(reply, /what can i help with|how can i help/i);
});

test('buildAssistantReply gives a booking-focused follow-up instead of a generic script', () => {
  const profile = {
    business: 'Grand Harbor Hotel',
    businessType: 'Hotel',
    serviceName: 'Deluxe Room',
    price: '$180',
    hours: 'Open 24/7',
    description: 'We offer deluxe rooms, suites, and weekend stays for couples and families.'
  };

  const conversation = [
    { from: 'customer', text: 'I need to book a room for Friday' },
    { from: 'ai', text: 'I can help with that. What dates are you looking at?' }
  ];

  const reply = buildAssistantReply('Please book a room for two adults', profile, conversation);

  assert.match(reply, /room|booking|dates|check/i);
  assert.match(reply, /two adults|guests|preferred/i);
});

test('buildAssistantRequestPayload packages the profile and conversation for a real AI request', () => {
  const profile = {
    business: 'Grand Harbor Hotel',
    businessType: 'Hotel',
    serviceName: 'Deluxe Room',
    price: '$180',
    hours: 'Open 24/7',
    description: 'We offer deluxe rooms, suites, and weekend stays for couples and families.'
  };

  const conversation = [
    { from: 'customer', text: 'I need a room' },
    { from: 'ai', text: 'I can help with that.' }
  ];

  const payload = buildAssistantRequestPayload('Book a room for two adults', profile, conversation);

  assert.equal(payload.message, 'Book a room for two adults');
  assert.equal(payload.profile.business, 'Grand Harbor Hotel');
  assert.equal(payload.conversation.length, 2);
  assert.match(payload.systemPrompt, /concierge|receptionist/i);
});
