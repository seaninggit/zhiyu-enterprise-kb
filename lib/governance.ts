import { getD1 } from "../db";

export async function runGovernanceMaintenance(){
  const db=getD1();
  const due=await db.prepare(`SELECT d.id,d.title,d.owner_user_id,d.create_user_id,d.dept_id FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.review_due_at IS NOT NULL AND d.review_due_at<=date('now','+30 day') LIMIT 100`).all<Record<string,unknown>>();
  for(const doc of due.results){const receiver=Number(doc.owner_user_id||doc.create_user_id);await db.prepare(`INSERT INTO notifications(user_id,type,title,content,document_id) SELECT ?,'REVIEW_DUE','知识即将到期复核',?,? WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=? AND type='REVIEW_DUE' AND document_id=? AND create_time>=date('now','-30 day'))`).bind(receiver,`《${doc.title}》需在复核日期前确认有效性`,doc.id,receiver,doc.id).run();}
  const setting=await db.prepare("SELECT value FROM system_settings WHERE key='governance.auto_expire'").first<{value:string}>().catch(()=>null);
  let expired=0;if(setting?.value!=="0"){const result=await db.prepare(`UPDATE documents SET status='EXPIRED_VOID',verification_status='EXPIRED',update_time=CURRENT_TIMESTAMP WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' AND review_due_at IS NOT NULL AND review_due_at<date('now')`).run();expired=Number(result.meta.changes||0);}
  const orphaned=await db.prepare(`SELECT COUNT(*) count FROM documents d LEFT JOIN users owner ON owner.id=d.owner_user_id WHERE d.is_deleted=0 AND d.owner_user_id IS NOT NULL AND (owner.id IS NULL OR owner.status<>'ACTIVE')`).first<{count:number}>();
  return{due:due.results.length,expired,transferred:0,ownerTransferRequired:Number(orphaned?.count||0)};
}
