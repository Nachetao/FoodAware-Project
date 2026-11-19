import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { AdminPage } from './admin.page';
import { CompartidoModule } from '../compartido/compartido.module';

/** /admin (solo administradores; adminGuard en app-routing.module.ts). */
@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CompartidoModule,
    RouterModule.forChild([{ path: '', component: AdminPage }]),
  ],
  declarations: [AdminPage],
})
export class AdminPageModule {}
