import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { authGuard } from '../auth/auth.guard';
import { LoginPage } from './login.page';
import { PerfilPage } from './perfil.page';
import { RegistroPage } from './registro.page';
import { SelectorAlergiasComponent } from './selector-alergias.component';

/** /login, /registro y /perfil (privada), cargadas juntas en un módulo lazy. */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([
      { path: 'login', component: LoginPage },
      { path: 'registro', component: RegistroPage },
      { path: 'perfil', component: PerfilPage, canActivate: [authGuard] },
    ]),
  ],
  declarations: [LoginPage, RegistroPage, PerfilPage, SelectorAlergiasComponent],
})
export class CuentaModule {}
