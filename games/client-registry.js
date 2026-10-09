'use client';
/**
 * Browser-side game modules. The platform renders a game only through this
 * entry: defaultSettings, SettingsForm, settingsSummary, Guide, TableView.
 */
import { defaultSettings, settingsSummary } from './thulla/settings.js';
import { SettingsForm } from './thulla/client/SettingsForm';
import { ThullaTableView } from './thulla/client/TableView';

export const clientGames = {
  thulla: { id: 'thulla', defaultSettings, settingsSummary, SettingsForm, TableView: ThullaTableView },
};
