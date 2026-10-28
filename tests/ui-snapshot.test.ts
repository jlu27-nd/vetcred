import { describe, expect, it } from 'vitest';
import { draftSnapshot } from '../src/components/portfolio-panel';
import { defaultSettings, emptyProfile, type Workspace } from '../src/lib/types';

function fixture(hidden:string[]):Workspace{return {
  user:{id:'veteran',email:'sample@example.invalid',role:'veteran'},cases:[],
  case:{id:'case',organizationId:'organization',ownerId:'veteran',state:'draft',revision:1,isSample:true,profile:emptyProfile,settings:{...defaultSettings,hidden}},
  assets:[{id:'photo',kind:'photo',name:'Sample',mime:'image/webp',size:100,status:'ready',data:{selected:true,cover:true,caption:'A selected sample'}}],
  sources:[],stories:[],claims:[],reviews:[],shares:[],jobs:[],configuration:{generation:false,transcription:false},
};}

describe('draft portfolio privacy matches publication',()=>{
  it('omits selected media and the cover when the photos section is hidden',()=>{
    const snapshot=draftSnapshot(fixture(['photos']));
    expect(snapshot.sections).not.toContain('photos');
    expect(snapshot.photos).toEqual([]);
  });
  it('includes the selected cover when the photos section is visible',()=>{
    expect(draftSnapshot(fixture([])).photos).toEqual([{id:'photo',caption:'A selected sample',cover:true}]);
  });
});
