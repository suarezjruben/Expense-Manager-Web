import { Routes } from '@angular/router';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { TransactionsPageComponent } from './pages/transactions-page.component';
import { PlansPageComponent } from './pages/plans-page.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardPageComponent },
  { path: 'transactions', component: TransactionsPageComponent },
  { path: 'plans', component: PlansPageComponent },
  { path: '**', redirectTo: 'dashboard' }
];
