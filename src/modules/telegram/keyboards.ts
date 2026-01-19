import { InlineKeyboardMarkup, InlineKeyboardButton } from 'telegraf/types';

/**
 * Create inline keyboard for recommendation actions
 */
export function createRecommendationKeyboard(actionId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Согласен', callback_data: `approve:${actionId}` },
        { text: '❌ Нет', callback_data: `reject:${actionId}` },
      ],
      [
        { text: '💬 Почему?', callback_data: `explain:${actionId}` },
        { text: '✏️ Изменить', callback_data: `modify:${actionId}` },
      ],
    ],
  };
}

/**
 * Create inline keyboard for campaign selection
 */
export function createCampaignKeyboard(
  campaigns: { id: string; name: string }[]
): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[][] = campaigns.map((c) => [
    { text: c.name, callback_data: `campaign:${c.id}` },
  ]);

  buttons.push([{ text: '🔙 Назад', callback_data: 'back' }]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for report period selection
 */
export function createPeriodKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Вчера', callback_data: 'period:yesterday' },
        { text: 'Неделя', callback_data: 'period:week' },
      ],
      [
        { text: 'Месяц', callback_data: 'period:month' },
        { text: 'Произвольный', callback_data: 'period:custom' },
      ],
    ],
  };
}

/**
 * Create inline keyboard for confirmation
 */
export function createConfirmKeyboard(actionId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `confirm:${actionId}` },
        { text: '❌ Отмена', callback_data: `cancel:${actionId}` },
      ],
    ],
  };
}

/**
 * Create inline keyboard for main menu
 */
export function createMainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 Отчёт за сегодня', callback_data: 'menu:report' },
        { text: '📈 Недельный отчёт', callback_data: 'menu:week' },
      ],
      [
        { text: '🎯 Кампании', callback_data: 'menu:campaigns' },
        { text: '💡 Предложения', callback_data: 'menu:proposals' },
      ],
      [
        { text: '📉 Статистика AI', callback_data: 'menu:usage' },
        { text: '⚙️ Настройки', callback_data: 'menu:settings' },
      ],
    ],
  };
}

/**
 * Create inline keyboard for settings
 */
export function createSettingsKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🔔 Уведомления', callback_data: 'settings:notifications' },
        { text: '⏰ Расписание', callback_data: 'settings:schedule' },
      ],
      [
        { text: '🎯 Цели', callback_data: 'settings:goals' },
        { text: '🔑 API ключи', callback_data: 'settings:api' },
      ],
      [{ text: '🔙 Назад', callback_data: 'back' }],
    ],
  };
}

/**
 * Create inline keyboard for context switching
 */
export function createContextKeyboard(
  campaigns: { id: string; name: string }[],
  currentCampaignId?: string
): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[][] = campaigns.map((c) => [
    {
      text: c.id === currentCampaignId ? `✓ ${c.name}` : c.name,
      callback_data: `switch_context:${c.id}`,
    },
  ]);

  buttons.push([{ text: '🌐 Общий контекст', callback_data: 'switch_context:global' }]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for campaign clarification
 */
export function createCampaignClarificationKeyboard(
  campaigns: { id: string; name: string }[]
): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[][] = campaigns.map((c) => [
    { text: c.name, callback_data: `set_campaign:${c.id}` },
  ]);

  buttons.push([{ text: '❌ Отмена', callback_data: 'cancel_clarification' }]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for proposal clarification
 */
export function createProposalClarificationKeyboard(
  proposals: { id: string; title: string }[]
): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[][] = proposals.map((p) => [
    { text: p.title, callback_data: `set_proposal:${p.id}` },
  ]);

  buttons.push([{ text: '❌ Отмена', callback_data: 'cancel_clarification' }]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for proposal selection
 */
export function createProposalKeyboard(
  proposals: { id: string; title: string; status: string }[]
): InlineKeyboardMarkup {
  const statusEmoji: Record<string, string> = {
    draft: '📝',
    discussing: '💬',
    approved: '✅',
    implemented: '🚀',
  };

  const buttons: InlineKeyboardButton[][] = proposals.map((p) => [
    {
      text: `${statusEmoji[p.status] || '📋'} ${p.title}`,
      callback_data: `proposal:${p.id}`,
    },
  ]);

  buttons.push([{ text: '🔙 Назад', callback_data: 'back' }]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for current context display
 */
export function createCurrentContextKeyboard(
  currentCampaign?: { id: string; name: string },
  currentProposal?: { id: string; title: string }
): InlineKeyboardMarkup {
  const buttons: InlineKeyboardButton[][] = [];

  if (currentCampaign) {
    buttons.push([
      { text: `🎯 ${currentCampaign.name}`, callback_data: `campaign:${currentCampaign.id}` },
    ]);
  }

  if (currentProposal) {
    buttons.push([
      { text: `💡 ${currentProposal.title}`, callback_data: `proposal:${currentProposal.id}` },
    ]);
  }

  buttons.push([
    { text: '🔄 Сменить контекст', callback_data: 'menu:campaigns' },
    { text: '🌐 Сбросить', callback_data: 'clear_context' },
  ]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Create inline keyboard for proposal actions
 */
export function createProposalActionKeyboard(proposalId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Утвердить', callback_data: `proposal_approve:${proposalId}` },
        { text: '✏️ Изменить', callback_data: `proposal_edit:${proposalId}` },
      ],
      [{ text: '❌ Отклонить', callback_data: `proposal_reject:${proposalId}` }],
    ],
  };
}

/**
 * Remove inline keyboard
 */
export function removeKeyboard(): { remove_keyboard: true } {
  return { remove_keyboard: true };
}

export default {
  createRecommendationKeyboard,
  createCampaignKeyboard,
  createPeriodKeyboard,
  createConfirmKeyboard,
  createMainMenuKeyboard,
  createSettingsKeyboard,
  createContextKeyboard,
  createCampaignClarificationKeyboard,
  createProposalClarificationKeyboard,
  createProposalKeyboard,
  createProposalActionKeyboard,
  createCurrentContextKeyboard,
  removeKeyboard,
};
