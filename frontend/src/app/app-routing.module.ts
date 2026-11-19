import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { adminGuard } from './auth/admin.guard';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then( m => m.HomePageModule)
  },
  {
    path: 'busqueda',
    loadChildren: () => import('./busqueda/busqueda.module').then( m => m.BusquedaPageModule)
  },
  {
    path: 'producto/:codigo',
    loadChildren: () => import('./producto/producto.module').then( m => m.ProductoPageModule)
  },
  {
    path: 'metricas',
    loadChildren: () => import('./metricas/metricas.module').then( m => m.MetricasPageModule)
  },
  {
    // Solo administradores; el backend también responde 403 a los demás.
    path: 'admin',
    canActivate: [adminGuard],
    loadChildren: () => import('./admin/admin.module').then( m => m.AdminPageModule)
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  },
  {
    // /login, /registro y /perfil (privada, con authGuard).
    path: '',
    loadChildren: () => import('./cuenta/cuenta.module').then( m => m.CuentaModule)
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
