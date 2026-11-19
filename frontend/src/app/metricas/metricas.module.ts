import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { MetricasPage } from './metricas.page';
import { CompartidoModule } from '../compartido/compartido.module';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CompartidoModule,
    RouterModule.forChild([{ path: '', component: MetricasPage }]),
  ],
  declarations: [MetricasPage],
})
export class MetricasPageModule {}
