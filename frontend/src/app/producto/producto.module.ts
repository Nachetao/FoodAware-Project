import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { ProductoPage } from './producto.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: ProductoPage }]),
  ],
  declarations: [ProductoPage],
})
export class ProductoPageModule {}
