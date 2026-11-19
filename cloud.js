/* Public connection settings. No service-role key or password belongs here. */
const CENTER_URL='https://fcqloaiaklnszcohxnum.supabase.co';
const CENTER_KEY='sb_publishable_BVxq6j3SS70fNDOkGP7v2A_irvpeC4g';
const centerDb=window.supabase?.createClient(CENTER_URL,CENTER_KEY,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.sessionStorage}
});
function apiResult(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data};}
async function centerRpc(name,args={}){
 if(!centerDb)throw Error('Supabase client unavailable');
 const {data,error}=await centerDb.rpc(name,args);
 if(error){const message=error.message||'';return apiResult({error:message},/CONFLICT/.test(message)?409:/RATE_LIMIT/.test(message)?429:error.code==='42501'?403:/INVALID|DUPLICATE|CLUB_IDS|TOO_MANY/.test(message)?400:500);}
 return apiResult(data);
}
async function centerApi(path,body){
 if(!centerDb)throw Error('Supabase client unavailable');
 if(path==='login'){
  const {error}=await centerDb.auth.signInWithPassword({email:body.email,password:body.password});
  if(error)return apiResult({},error.status||401);
  const state=await centerRpc('center_get_state');
  if(!state.ok || !(await state.json()).admin){await centerDb.auth.signOut();return apiResult({},403);}
  return apiResult({});
 }
 if(path==='logout'){const {error}=await centerDb.auth.signOut();return apiResult({},error?500:200);}
 if(path==='state')return centerRpc('center_get_state');
 if(path==='save'){
  const prepared=await prepareCloudImages(body.data);
  const response=await centerRpc('center_save',{expected_revision:body.revision,new_data:prepared});
  if(response.ok)Object.assign(body.data,prepared);
  return response;
 }
 if(path==='users')return centerRpc('center_users');
 if(path==='user'||path==='delete-user')return centerRpc('center_assign_staff',{email:body.email,club_ids:body.clubIds||[],remove_access:path==='delete-user'});
 if(path==='apply')return centerRpc('center_apply',{payload:body});
 if(path==='applications')return centerRpc('center_applications');
 if(path==='application-status')return centerRpc('center_application_status',{application_id:body.id,new_status:body.status});
 return apiResult({},404);
}
const imageUploadCache=new Map();
async function uploadCloudImage(value,folder){
 if(!value?.startsWith('data:image/'))return value;
 const cached=imageUploadCache.get(folder+'|'+value);if(cached)return cached;
 const source=await (await fetch(value)).blob();
 if(source.size>20*1024*1024)throw Error('Image too large');
 const img=await createImageBitmap(source), scale=Math.min(1,1920/Math.max(img.width,img.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);img.close();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));if(!blob)throw Error('Image conversion failed');
 const path=folder+'/'+crypto.randomUUID()+'.jpg';
 const {error}=await centerDb.storage.from('center-media').upload(path,blob,{contentType:'image/jpeg',upsert:false});
 if(error)throw error;
 const url=centerDb.storage.from('center-media').getPublicUrl(path).data.publicUrl;
 imageUploadCache.set(folder+'|'+value,url);return url;
}
async function prepareCloudImages(input){
 const data=JSON.parse(JSON.stringify(input));
 if(activeUser?.role==='owner')data.heroBg=await uploadCloudImage(data.heroBg,'center');
 for(const club of data.clubs){if(canEditClub(club.id))club.img=await uploadCloudImage(club.img,club.id);}
 for(const post of data.posts){if(canEditClub(post.clubId))post.img=await uploadCloudImage(post.img,post.clubId);}
 for(const story of data.stories){
  story.clubId=story.clubId||data.clubs.find(c=>c.title===story.club)?.id||'center';
  if(canEditClub(story.clubId))story.img=await uploadCloudImage(story.img,story.clubId);
 }
 return data;
}
async function importLocalState(event){
 const file=event.target.files[0];if(!file||activeUser?.role!=='owner')return;
 if(!confirm('Ներմուծե՞լ հին տվյալները։ Ներկայիս նյութերն ու աշակերտների ցուցակները կփոխարինվեն ֆայլի տվյալներով։')){event.target.value='';return;}
 try{
  if(file.size>30*1024*1024)throw Error('File too large');
  const imported=JSON.parse(await file.text()), source=imported.data||imported;
  if(!Array.isArray(source.clubs)||!Array.isArray(source.posts)||!Array.isArray(source.stories))throw Error('Invalid state');
  source.mainTitle='Շողակաթի զարգացման կենտրոն';
  for(const club of source.clubs){club.students=Array.isArray(club.students)?club.students:[];delete club.studentCount;}
  showToast('Տվյալները ներմուծվում են…');event.target.disabled=true;
  const data=await prepareCloudImages(source);
  const result=await centerRpc('center_import',{expected_revision:revision,imported_data:data,imported_applications:imported.applications||[]});
  if(!result.ok)throw Error((await result.json()).error);
  await refresh();populateAdminLists();showToast('Նյութերը, ցուցակներն ու դիմումները ներմուծված են։ Մուտքի հաշիվները ստեղծեք Supabase-ում։');
 }catch(error){showToast('Ներմուծումը չավարտվեց։ Ստուգեք ֆայլը և կապը։');console.warn('Import failed',error.message);}
 finally{event.target.disabled=false;event.target.value='';}
}
