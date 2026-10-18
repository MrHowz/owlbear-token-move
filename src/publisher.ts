/** Ordered snapshots prevent a slow older status from overwriting a newer command reply. */
export class OrderedPublisher<T> {
  private tail:Promise<void>=Promise.resolve();
  private pending=0;
  constructor(private send:(value:T)=>Promise<void>){}
  get busy(){return this.pending>0;}
  publish(value:T):Promise<void>{
    this.pending++;
    const delivery=this.tail.catch(()=>{}).then(()=>this.send(value));
    this.tail=delivery;
    return delivery.finally(()=>{this.pending--;});
  }
}
