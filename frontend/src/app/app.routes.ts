import { Routes } from '@angular/router';
import { LiveComponent } from './live/live.component';
import { HistoryComponent } from './history/history.component';

export const routes: Routes = [
  { path: 'live', component: LiveComponent, title: 'Live transcription' },
  { path: 'history', component: HistoryComponent, title: 'Transcription history' },
  { path: '', pathMatch: 'full', redirectTo: 'live' },
  { path: '**', redirectTo: 'live' },
];
