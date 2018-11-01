// My wishlist:
//
// Different way of calculating trails. Current method has hard limitations due to only being able to have 16 texture uniforms in a shader. WebGL2 transform feedback? Split trail into individual segment objects?
//
//
//


THREE.ParticleSystem = function( options ){

    THREE.Object3D.apply( this, arguments );

    options = options || {};

    this.GUI;

    this.params = {

        TIME_SCALE: options.timeScale !== undefined ? options.timeScale : 1,

        //Emitter
        MAX_PARTICLES: options.maxParticles !== undefined ? options.maxParticles : 10000,
        SPAWN_RATE: options.spawnRate !== undefined ? options.spawnRate : 100,
        ANIMATE_SPAWN: false, //Less memory efficient, stops rebuilding on spawn value change, will kill some PCs if using Physics

        SPAWN_EMITFROM: "face", //origin, vert, face, volume(WIP)
        SPAWN_ELDISTRIB: "random", //index, random,
        SPAWN_INDEX: 0,
        SPAWN_EMDISTRIB: "random", //centre, random(WIP) //grid(future job)//,
        GRID_RESOLUTION: 1,

        //Particles
        SIZE: options.size !== undefined ? options.size : 1,
        VAR_SIZE: options.varySize !== undefined ? options.varySize : 0,

        LIFETIME: options.lifetime !== undefined ? options.lifetime : 5,
        VAR_LIFETIME: options.varyLifetime !== undefined ? options.varyLifetime : 0,

        INIT_POS: this.opt_ToVec( options.initPosition !== undefined ? options.initPosition : 0 ),
        VAR_POS: this.opt_ToVec( options.varyPosition !== undefined ? options.varyPosition : 0 ),

        INIT_VEL: this.opt_ToVec( options.initVelocity !== undefined ? options.initVelocity : new THREE.Vector3( 0, 0, 0 ) ),
        NORM_VEL: options.normalVelocity !== undefined ? options.normalVelocity : 1,
        VAR_NORM_VEL: options.varyNormalVelocity !== undefined ? options.varyNormalVelocity : 0,
        VAR_VEL: this.opt_ToVec( options.varyVelocity !== undefined ? options.varyVelocity : 0 ),

        INIT_COL: this.opt_ToQuat( options.initColour !== undefined ? options.initColour : 1 ),
        VAR_COL: this.opt_ToQuat( options.varyColour !== undefined ? options.varyColour : 0 ),

        //Display
        DISPLAY_MODE: "shader", //shader, object, group
        INSTANCED: options.instanceObject !== undefined ? options.instanceObject : null,
        ATTEN_SIZE: options.sizeAttenuation !== undefined ? options.sizeAttenuation : true,

        //Physics
        ENABLE_PHYSICS : true,
        MASS: 1,
        CHARGE: 1,

    }

    this.PARTICLE_LIMIT_REACHED = false;

    this.forceCarriers = { "CustomForce": [], "ConstantForce": [], "PointForce": [] };

    this._offset = 0;
    this._count = 0;

    this.VERTEX_SHADER = `

        #include <gpup_shader_pars_vertex>

        varying vec4 vColor;
        varying vec2 vUv;

        void main() {

            vColor = texture2D( textureColour, reference );
            vUv = uv;

            float age = uTime - birthTime;

            if( age >= 0. && age < lifetime ){

                vec4 mvPosition = modelViewMatrix * vec4( ( position + texture2D( textureOffset, reference ).xyz ), 1.0 );

                gl_PointSize = size;

                #ifdef attenSize
                    if( projectionMatrix[2][3] == -1.0 ) gl_PointSize *= 20.0 / -mvPosition.z; //SIZE ATTENUATION
                #endif

                gl_Position = projectionMatrix * mvPosition;

            } else{

                gl_PointSize = 0.;

            }

        }
    `;

    this.FRAG_SHADER = `
        varying vec4 vColor;
        varying vec2 vUv;

        void main() {

            gl_FragColor = vec4( vColor );

        }
    `;

    this.physicsShaderChunks = [];

    this.raycaster = new THREE.Raycaster();
    this.trails = [];
    this._maxTrailLength = 1;

    this.DPR = window.devicePixelRatio;
    this.isParticleSystem = true;

    this.init();

}

THREE.ParticleSystem.prototype = Object.create( THREE.Object3D.prototype );
THREE.ParticleSystem.prototype.constructor = THREE.ParticleSystem;

Object.assign( THREE.ParticleSystem.prototype, {

    addTrails: function( length ){

        const positionArraybuilder = ( arr, clusterSize ) => {

            for( let i = 0; i < arr.length / clusterSize; i++ ){

                for( let j = 0; j < clusterSize; j++ ){

                    arr[ ( i * clusterSize + j ) * 3     ] = ( i % this.gpuCompute.texSize ) / this.gpuCompute.texSize;
                    arr[ ( i * clusterSize + j ) * 3 + 1 ] = ~~( i / this.gpuCompute.texSize ) / this.gpuCompute.texSize;
                    arr[ ( i * clusterSize + j ) * 3 + 2 ] = j%2;

                }

            }

            return arr

        }

        const positionAttribute = new THREE.BufferAttribute( new Float32Array( 2 * this._softParticleLimit * 3 ), 3 );
        positionArraybuilder( positionAttribute.array, 2 );
        console.log( positionAttribute );
        const trail = new THREE.Group();

        const trailMat = new THREE.ShaderMaterial( { transparent: true } );

        trailMat.vertexShader = `

            uniform sampler2D textureCurPos;
            uniform sampler2D textureLastPos;
            uniform sampler2D textureCurColour;
            uniform sampler2D textureLastColour;
            uniform float trailIndex;
            uniform float trailLength;

            varying float vtrailIndex;
            varying float vtrailLength;
            varying vec4 vColour;

            void main(){

                vec4 trailPosition = texture2D( textureCurPos, position.xy );
                vec4 altPosition = texture2D( textureLastPos, position.xy );


                vtrailLength = trailLength;

                if( length( trailPosition - altPosition ) > 0.5 ) trailPosition = altPosition;

                vec4 mvPosition;

                if( position.z == 1.0 ){
                    vtrailIndex = trailIndex + 1.0;
                    vColour = texture2D( textureLastColour, position.xy );
                    mvPosition = modelViewMatrix * vec4( altPosition.xyz, 1 );

                } else{
                    vtrailIndex = trailIndex;
                    vColour = texture2D( textureCurColour, position.xy );
                    mvPosition = modelViewMatrix * vec4( trailPosition.xyz, 1 );
                }

                gl_Position = projectionMatrix * mvPosition;

            }
        `;

        trailMat.fragmentShader = `

        varying float vtrailIndex;
        varying float vtrailLength;
        varying vec4 vColour;

        void main(){
            float alpha = 1.0 - vtrailIndex/vtrailLength;
            gl_FragColor = vec4( vColour.xyz, vColour.w * alpha );
        }

        `;

        trailMat.uniforms = {

            'textureCurPos': {
                value: null
            },
            'textureLastPos': {
                value: null
            },
            'textureCurColour': {
                value: null
            },
            'textureLastColour': {
                value: null
            }

        };

        let pars = "", texturePicker = "";

        trailMat.vertexShader = pars + trailMat.vertexShader.replace( "<<<TEXTURE_PICKER>>>", texturePicker );

        for( let i = 0; i < length; i++ ){

            const trailGeo = new THREE.BufferGeometry();

            trailGeo.addAttribute( 'position', positionAttribute );
            //trailGeo.addAttribute( 'reference', referenceAttribute );

            const trailSegmentMat = trailMat.clone();
            Object.assign( trailSegmentMat.uniforms, {
                'trailIndex': {
                    value: i
                },
                'trailLength': {
                    value: length
                }
            } );
            trail.add( new THREE.LineSegments( trailGeo, trailSegmentMat ) );

        }

        //trailGeo.addAttribute( 'colour', new THREE.BufferAttribute( new Float32Array( clusterSize * this._softParticleLimit * 4 ), 4 ).setDynamic( true ) );

        trail.length = length;

        this.add( trail );
        this.trails.push( trail );
        this.initComputeRenderer( false, length );

        return trail

    },

    calcOffset: function( position, velocity ){

        const find3DPos = ( source, normal ) => {

            let pos = new THREE.Vector3();

            switch( this.params.SPAWN_EMDISTRIB ){

                case "centre":

                    pos.x = source.reduce( ( acc, vert ) => acc + vert.x, 0)/source.length;
                    pos.y = source.reduce( ( acc, vert ) => acc + vert.y, 0)/source.length;
                    pos.z = source.reduce( ( acc, vert ) => acc + vert.z, 0)/source.length;

                    break;

                case "random":

                    let genPos;

                    switch( this.params.SPAWN_EMITFROM ){

                        case "face":

                            genPos = () => new THREE.Vector3().subVectors( source[1], source[0] ).multiplyScalar( Math.random() ).add( new THREE.Vector3().subVectors( source[2], source[0] ).multiplyScalar( Math.random() ) ).add( source[0] );

                            break;

                        case "volume":

                            genPos = () => {

                                const tmp = new THREE.Vector3().subVectors( this.parent.geometry.boundingBox.max, this.parent.geometry.boundingBox.min )
                                tmp.x = tmp.x * Math.random();
                                tmp.y = tmp.y * Math.random();
                                tmp.z = tmp.z * Math.random();

                                return tmp.add( this.parent.geometry.boundingBox.min );

                            };

                            break;

                    }

                    pos = genPos();
                    this.raycaster.set( pos, normal.clone().negate() );

                    while( this.raycaster.intersectObject( this.parent ).length === 0 ) {

                        pos = genPos();
                        this.raycaster.set( pos, normal.clone().negate() );

                    }

                    break;

            }

            return pos

        }

        let sourceIndex;
        let source;
        let index;
        let normal = new THREE.Vector3();

        switch( this.params.SPAWN_ELDISTRIB ){

            case "index":

                sourceIndex = pool => this.params.SPAWN_INDEX >= pool.length ? pool.length - 1 : this.params.SPAWN_INDEX;
                break;

            case "random":

                sourceIndex = pool => THREE.Math.randInt( 0, pool.length - 1 );
                break;

        }

        switch( this.params.SPAWN_EMITFROM ){

            case "origin":

                source = this.parent.position;
                normal = this.parent.up;
                position.add( source );
                break;

            case "vert":

                index = sourceIndex( this.parent.geometry.vertices )

                source = this.parent.geometry.vertices[ index ];
                normal = this.parent.geometry.faces.map( face => face.vertexNormals[ Object.values( face ).indexOf( index ) ] ).filter( el => el )[0];
                position.add( source );

                break;

            case "face":

                index = sourceIndex( this.parent.geometry.faces )

                normal = this.parent.geometry.faces[ index ].normal;
                source = find3DPos( Object.values( this.parent.geometry.faces[ index ] ).slice( 0, 3 ).map( vert => this.parent.geometry.vertices[ vert ] ), normal.clone() );
                position.add( source );

                break;

            case "volume":

                normal = this.parent.up;
                source = find3DPos( this.parent.geometry.vertices, normal.clone() );
                position.add( source );
                break;

        }



        return [ position, normal ]

    },

    exportState: function(){

        console.log ( JSON.stringify( this.params ) );

    },

    init: function( overwrite ){

        if( this.points && !overwrite ){ console.warn( "System already initialised! Use .init( true ) to overwrite." ); return };

        this.initComputeRenderer( true, this._maxTrailLength );

        this.ACTIVE_PARTICLE = 0;
        this.rateCounter = 0;
        this.TIME = 0;

        if( this.points ){ this.dispose(); };

        this.remove( this.points );
        this.points = this.params.DISPLAY_MODE === "object" && this.instanceObject ? new THREE.Mesh() : new THREE.Points();
        this.refreshGeo();
        this.refreshMaterial();

        this.add( this.points );


        this.trails = this.trails.reduce( ( acc, trail, i, arr ) => {

            this.remove( trail );
            acc.push( this.addTrails( trail.length ) );

            return acc

        }, [])

    },

    initComputeRenderer: function( rewrite, history ){

        history = history !== undefined ? history : this._maxTrailLength;

        let physObjs = this.enablePhysics ? this.forceCarriers : { "CustomForce": [], "ConstantForce": [], "PointForce": [] };

        const getVelocityFragment = () => {

            const frag = THREE.ShaderChunk.gpup_velocity_frag;
            let shader_pars = "", shader_main = "";

            let chunks = [];

            if( this.enablePhysics ) {

                //chunks = chunks.concat( this.physicsShaderChunks );

                if( this.forceCarriers["ConstantForce"].length ) chunks.push({
                                                            pars: THREE.ShaderChunk.gpup_physics.const_pars,
                                                            main: THREE.ShaderChunk.gpup_physics.const_main,
                                                            replaces: [ {string: "NUM_CONST_PHYS_ATTR", value: this.forceCarriers["ConstantForce"].length} ]
                                                        });

                if( this.forceCarriers["PointForce"].length ) chunks.push ({
                                                            pars: THREE.ShaderChunk.gpup_physics.point_pars,
                                                            main: THREE.ShaderChunk.gpup_physics.point_main,
                                                            replaces: [ {string: "NUM_POINT_PHYS_ATTR", value: this.forceCarriers["PointForce"].length} ]
                                                        });


                this.forceCarriers["CustomForce"].forEach( force => {

                    chunks.push({
                        pars: force.fragmentPars,
                        main: force.fragmentMain,
                    })

                })

                chunks.forEach( chunk => {

                    chunk.replaces && chunk.replaces.forEach( replace => {

                        const re = new RegExp( replace.string, "g" );

                        if( chunk.pars ) chunk.pars = chunk.pars.replace( re, replace.value );
                        if( chunk.main ) chunk.main = chunk.main.replace( re, replace.value );

                    });

                    if( chunk.pars ) shader_pars = shader_pars + chunk.pars;
                    if( chunk.main ) shader_main = shader_main + chunk.main;


                });

            };

            return frag.replace( "<<<PHYSICS_PARS_CHUNK>>>", shader_pars ).replace( "<<<PHYSICS_MAIN_CHUNK>>>", shader_main );

        };

        let texSize = Math.pow( 2, Math.ceil( Math.log2( Math.sqrt( this._softParticleLimit ) ) ) );

        if( ( this.gpuCompute ? texSize !== this.gpuCompute.texSize : true ) || history > this._maxTrailLength || rewrite ){

            this._maxTrailLength = history;

            let gpuCompute = new GPUComputationRenderer( texSize, texSize, renderer, history );
            gpuCompute.texSize = texSize;

            //Create new textures, or reuse old data
            let dataOffset, dataVelocity, dataColour;

            dataOffset = this.gpuCompute ? this.gpuCompute.getCurrentRenderTarget( this.offsetVar ).texture : gpuCompute.createTexture();
            dataVelocity = this.gpuCompute ? this.gpuCompute.getCurrentRenderTarget( this.velocityVar ).texture : gpuCompute.createTexture();
            dataColour = this.gpuCompute ? this.gpuCompute.getCurrentRenderTarget( this.colourVar ).texture : gpuCompute.createTexture();

            //Variable holders
            let offsetVar = gpuCompute.addVariable( "textureOffset", THREE.ShaderChunk.gpup_offset_frag, dataOffset );
            let velocityVar = gpuCompute.addVariable( "textureVelocity", getVelocityFragment(), dataVelocity );
            let colourVar = gpuCompute.addVariable( "textureColour", THREE.ShaderChunk.gpup_colour_frag, dataColour );

            velocityVar.wrapS = THREE.RepeatWrapping;
            velocityVar.wrapT = THREE.RepeatWrapping;
            offsetVar.wrapS = THREE.RepeatWrapping;
            offsetVar.wrapT = THREE.RepeatWrapping;
            colourVar.wrapS = THREE.RepeatWrapping;
            colourVar.wrapT = THREE.RepeatWrapping;

            //Variable dependencies
            gpuCompute.setVariableDependencies( offsetVar, [ velocityVar, offsetVar ] );
            gpuCompute.setVariableDependencies( velocityVar, [ velocityVar, offsetVar ] );
            gpuCompute.setVariableDependencies( colourVar, [ velocityVar, offsetVar, colourVar ] );

            //Uniform templates
            let infoUniform, newVelUniform, newPosUniform;

            infoUniform =   { value: new THREE.DataTexture( new Float32Array( Math.pow( texSize, 2 ) * 3 ), texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };
            newVelUniform = { value: new THREE.DataTexture( new Float32Array( Math.pow( texSize, 2 ) * 3 ), texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };
            newPosUniform = { value: new THREE.DataTexture( new Float32Array( Math.pow( texSize, 2 ) * 3 ), texSize, texSize, THREE.RGBFormat, THREE.FloatType ) };
            newColUniform = { value: new THREE.DataTexture( new Float32Array( Math.pow( texSize, 2 ) * 4 ), texSize, texSize, THREE.RGBAFormat, THREE.FloatType ) };

            let offsetUniforms = offsetVar.material.uniforms;
            let velocityUniforms = velocityVar.material.uniforms;
            let colourUniforms = colourVar.material.uniforms;

            //Frame tick
            offsetUniforms.delta = { value: 0.0 };
            velocityUniforms.delta = { value: 0.0 };

            //Time
            colourUniforms.uTime = { value: this.TIME };

            //New positions on particle spawn
            offsetUniforms.newPos = newPosUniform;

            //New velocities on particle spawn
            offsetUniforms.newVel = newVelUniform;
            velocityUniforms.newVel = newVelUniform;

            //New colours on particle spawn
            colourUniforms.newCol = newColUniform;

            //Particle info containers (updated/mass/charge)
            offsetUniforms.particleInfo = infoUniform;
            velocityUniforms.particleInfo = infoUniform;
            colourUniforms.particleInfo = infoUniform;

            let error = gpuCompute.init();
            if ( error !== null ) {
                console.error( error );
            };

            this.gpuCompute = gpuCompute;
            this.offsetVar = offsetVar;
            this.velocityVar = velocityVar;
            this.velocityUniforms = velocityUniforms;
            this.colourVar = colourVar;

        } else{

            this.velocityVar.material.fragmentShader = "\nuniform sampler2D textureOffset;\nuniform sampler2D textureVelocity;\n" + getVelocityFragment();
            this.velocityVar.material.needsUpdate = true;

        }

        //Forcefields
        this.velocityUniforms.forcefields_const = {
            properties: { acceleration: {} },
            value: physObjs["ConstantForce"]
        };
        this.velocityUniforms.forcefields_point = {
            properties: { position: {}, strength: {}, decay: {} },
            value: physObjs["PointForce"]
        };

        //External shader uniforms
        Object.assign( this.velocityUniforms, physObjs["CustomForce"].reduce( ( acc, chunk ) => Object.assign( acc, chunk.uniforms ), {} ) )

    },

    assignForceCarrier: function( value ){

        if( value.isForceCarrier ){

            if( this.forceCarriers[value.type].indexOf( value ) ){

                this.forceCarriers[value.type].push( value );
                this.initComputeRenderer( false, this._maxTrailLength );

            }

        }

    },

    removeForceCarrier: function( value ){

        this.forceCarriers[value.type].splice( this.forceCarriers[value.type].indexOf( value ), 1 );
        this.initComputeRenderer();

    },

    opt_ToVec: function( value ){

        let option;

        if( value instanceof THREE.Vector3 ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Vector3( value.x, value.y, value.z );
        } else{
            option = new THREE.Vector3( value, value, value );
        }

        return option


    },

    opt_ToQuat: function( value ){

        let option;

        if( value instanceof THREE.Quaternion ){
            option = value;
        } else if( value instanceof Object ){
            option = new THREE.Quaternion( value.x || value.r, value.y || value.g, value.z || value.b, value.w || value.a );
        } else{
            option = new THREE.Quaternion( value, value, value, value );
        }

        return option


    },

    refreshGeo: function(){

        let particleGeo;
        let attrBuilder;

        const referenceArrayBuilder = arr => {

            for( let i = 0; i < arr.length / 2; i++ ){

                arr[ i * 2     ] = ( i % this.gpuCompute.texSize ) / this.gpuCompute.texSize;
                arr[ i * 2 + 1 ] = ~~( i / this.gpuCompute.texSize ) / this.gpuCompute.texSize

            }

            return arr
        }

        if( this.params.DISPLAY_MODE === "object" && this.instanceObject ){

            particleGeo = new THREE.InstancedBufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.InstancedBufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            const instanceGeo = new THREE.BufferGeometry().fromGeometry( this.instanceObject.geometry );

            particleGeo.addAttribute( 'position',   instanceGeo.attributes.position );
            particleGeo.addAttribute( 'normal',     instanceGeo.attributes.normal );
            particleGeo.addAttribute( 'color',      instanceGeo.attributes.color );
            particleGeo.addAttribute( 'uv',         instanceGeo.attributes.uv );

        } else{

            particleGeo = new THREE.BufferGeometry();
            attrBuilder = ( arrSize, itemSize ) => new THREE.BufferAttribute( new Float32Array( arrSize * itemSize ), itemSize ).setDynamic( true );

            particleGeo.addAttribute( 'position',  attrBuilder( this._softParticleLimit, 3 ) );

        }

        particleGeo.addAttribute( 'reference',  attrBuilder( this._softParticleLimit, 2 ) );
        referenceArrayBuilder( particleGeo.attributes.reference.array );
        particleGeo.addAttribute( 'birthTime',  attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'size',       attrBuilder( this._softParticleLimit, 1 ) );
        particleGeo.addAttribute( 'lifetime',   attrBuilder( this._softParticleLimit, 1 ) );


        this.points.geometry = particleGeo;
        return particleGeo;

    },

    refreshMaterial: function(){

        let particleMat;

        let uniforms = {
            'uTime': {
                value: 0.0
            },
            'textureOffset': {
                value: null
            },
            'textureVelocity': {
                value: null
            },
            'textureColour': {
                value: null
            }
        };

        let defines = {

            'attenSize': {
                value: this.sizeAttenuation
            }

        }

        if( this.params.DISPLAY_MODE === "object" && this.instanceObject ){

            particleMat = this.instanceObject.material.clone();

            particleMat.uniforms = Object.assign( particleMat.uniforms || {}, uniforms );

            particleMat.onBeforeCompile = ( shader, renderer ) => {

                shader.vertexShader = Object.keys( defines ).map( define => defines[define].value ? "#define " + define : "" ) + "\n#include <gpup_shader_pars_vertex>\n" + shader.vertexShader.replace( "begin_vertex", "begin_vertex_modified" ).replace( "morphtarget_vertex", "morphtarget_vertex_modified" );

                shader.uniforms = Object.assign( shader.uniforms, uniforms );

            };

        } else{

            particleMat =  new THREE.ShaderMaterial( {

                                        vertexShader: Object.keys( defines ).map( define => defines[define].value ? "#define " + define : "" ) + this.VERTEX_SHADER,
                                        fragmentShader: this.FRAG_SHADER,
                                        uniforms: uniforms,
                                        blending: THREE.NormalBlending,
                                        transparent: true,

                                    });


        }

        if( this.points.material ){ this.points.material.dispose() };
        this.points.material = particleMat;

        return particleMat

    },

    buildOptions: function(){

        if( !this.parent ){ console.warn( "No parent object!" ); return; };

        let gui = new dat.GUI();
        this.GUI = gui;

        const assertNumericController = ( parent, name, toShow, rangeFrom, rangeTo ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, rangeFrom, rangeTo , 1 );
            }
        };

        const assertStringController = ( parent, name, toShow, range ) => {
            cont = parent.__controllers.filter( cont => cont.property === name )[0];
            cont && cont.remove();
            if ( toShow ){
                parent.add( this, name, range );
            }
        };

        const addVectorProp = ( parent, name, property, rangeFrom, rangeTo ) => {

            let cont = parent.addFolder( name );
            cont.add( property, "x", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "y", rangeFrom, rangeTo, 0.1 );
            cont.add( property, "z", rangeFrom, rangeTo, 0.1 );
            property instanceof THREE.Quaternion &&  cont.add( property, "w", rangeFrom, rangeTo, 0.1 );

        };

        //////Emitter Settings//////
        let emitter = gui.addFolder( "Emitter" );
        emitter.add( this, "spawnRate", 0, 500, 10 );
        emitter.add( this, "animateSpawn" ).onChange( () => this.init( true ) );

        let source = emitter.addFolder( "Source" );
        const assertEmitIndex = () => assertNumericController( source, "emitIndex", ["vert","face"].includes( this.emitFrom ) && this.elementDistribution === "index", 0, ( this.emitFrom === "vert" ? this.parent.geometry.vertices.length : this.parent.geometry.faces.length ) - 1 );
        const assertEmitDistribution = () => assertStringController( source, "emitDistribution", ["face","volume"].includes( this.emitFrom ), { Centre: "centre", "Random(WIP)": "random", "//Grid": "grid" } );

        source.add( this, "emitFrom", { Centre: "origin", Vertex: "vert", Face: "face", Volume: "volume" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        source.add( this, "elementDistribution", { Index: "index", Random: "random" } ).onChange( () => {assertEmitIndex(); assertEmitDistribution()} );
        assertEmitIndex();
        assertEmitDistribution();

        //////Particle Settings//////
        let particle = gui.addFolder( "Particle" );

        let lifetime = particle.addFolder( "Lifetime" );
        lifetime.add( this, "lifetime", 0, 10, 0.1 );
        lifetime.add( this, "varyLifetime", 0, 10, 0.1 );

        let size = particle.addFolder( "Size" );
        size.add( this, "size", 0.1, 20, 0.1 );
        size.add( this, "varySize", 0, 20, 1 );

        let position = particle.addFolder( "Position" );
        addVectorProp( position, "Initial", this.initPosition, -5, 5 );
        addVectorProp( position, "Variance", this.varyPosition, 0 ,5 );
        let velocity = particle.addFolder( "Velocity" );
        velocity.add( this, "normalVelocity", -5, 5, 0.1 );
        velocity.add( this, "varyNormalVelocity", 0, 1, 0.1 );
        addVectorProp( velocity, "Initial", this.initVelocity, -5, 5 );
        addVectorProp( velocity, "Variance", this.varyVelocity, 0, 5 );
        let color = particle.addFolder( "Color" );
        addVectorProp( color, "Initial", this.initColour, 0, 1 );
        addVectorProp( color, "Variance", this.varyColour, 0, 1 );

        //////Display Settings//////
        let display = gui.addFolder( "Display" );
        display.add( this, "displayMode", {Point: "shader", Object: "object"});

        gui.add( this, "enablePhysics" );
        gui.add( this, "exportState" );

    },

    removeOptions: function(){

        this.GUI.destroy();
        this.GUI = undefined;

    },

    spawnParticle: function(){

        const varyAttribute = attr => attr * THREE.Math.randFloat( -1, 1 );
        const i = this.ACTIVE_PARTICLE;
        this._offset = this._offset === null ? i : this._offset;
        this._count++;

        const birthTimeAttribute =  this.points.geometry.getAttribute( 'birthTime' );
        const sizeAttribute =       this.points.geometry.getAttribute( 'size' );
        const lifetimeAttribute =   this.points.geometry.getAttribute( 'lifetime' );

        //Particle Info
        this.offsetVar.material.uniforms.particleInfo.value.image.data[ i * 3     ] = 1;
        this.offsetVar.material.uniforms.particleInfo.value.image.data[ i * 3 + 1 ] = this.params.MASS;
        this.offsetVar.material.uniforms.particleInfo.value.image.data[ i * 3 + 2 ] = this.params.CHARGE;

        let [ position, normal ] = this.calcOffset( this.params.INIT_POS.clone() );

        //Position
        let newPos = this.offsetVar.material.uniforms.newPos.value.image.data;

        Object.keys( position ).forEach( ( dim, j ) => {
            newPos[ i * 3 + j ] = position[dim] + varyAttribute( this.params.VAR_POS[dim] );
        });

        //Velocity
        let newVel = this.velocityVar.material.uniforms.newVel.value.image.data;

        Object.keys( this.params.INIT_VEL ).forEach( ( dim, j ) => {
            newVel[ i * 3 + j ] = this.params.INIT_VEL[dim] + this.params.NORM_VEL * ( 1 - varyAttribute( this.params.VAR_NORM_VEL ) ) * normal[dim] + varyAttribute( this.params.VAR_VEL[dim] );
        });

        //Colour
        const colour = this.initColour.clone();
        const newCol = this.colourVar.material.uniforms.newCol.value.image.data

        Object.keys( colour ).forEach( ( dim, j ) => {

            colour[dim] = THREE.Math.clamp( colour[dim] + varyAttribute( this.params.VAR_COL[dim] ), 0, 1 );
            newCol[ i * 4 + j ] = colour[dim];

        });

        // size, lifetime and starttime
        sizeAttribute.array[ i ] = this.params.SIZE + varyAttribute( this.params.VAR_SIZE );
        lifetimeAttribute.array[ i ] = this.params.LIFETIME + varyAttribute( this.params.VAR_LIFETIME );
        birthTimeAttribute.array[ i ] = this.TIME;

        this.ACTIVE_PARTICLE = this.ACTIVE_PARTICLE >= this._softParticleLimit ? 0 : this.ACTIVE_PARTICLE + 1;

    },

    updateGeo: function(){

        if( this._count < 1 ) return;

        ['birthTime', 'size', 'lifetime'].forEach( attrName => {

            const attr = this.points.geometry.getAttribute( attrName );

            attr.updateRange.count = this._count * attr.itemSize;
            attr.updateRange.offset = this._offset * attr.itemSize;

            attr.needsUpdate = true;

        })

        this.offsetVar.material.uniforms.particleInfo.value.needsUpdate = true;
        this.offsetVar.material.uniforms.newPos.value.needsUpdate = true;
        this.velocityVar.material.uniforms.newVel.value.needsUpdate = true;
        this.colourVar.material.uniforms.newCol.value.needsUpdate = true;

    },

    update: function(){

        if( !this.parent ){ console.warn( "No parent object!" ); return; };

        let delta = clock.getDelta() * this.params.TIME_SCALE;
        delta = delta > .05 ? .05 : delta;

        this.TIME += delta;
        this._count = 0;
        this._offset = null;
        this.offsetVar.material.uniforms.particleInfo.value.image.data = this.offsetVar.material.uniforms.particleInfo.value.image.data.map( ( el, i ) => ( !(i%3) ? 0 : el ) );

        if( this.TIME < 0 ) this.TIME = 0;

        if ( delta > 0 && this.TIME > this.rateCounter/this.params.SPAWN_RATE ) {

            for( let i = 0; i < this.params.SPAWN_RATE*delta; i++){

                this.rateCounter++;
                this.spawnParticle();

            }

        }

        this.updateGeo();

        this.offsetVar.material.uniforms.delta.value = delta;
        this.velocityVar.material.uniforms.delta.value = delta;

        this.gpuCompute.compute();

        this.points.material.uniforms.uTime.value = this.TIME;
        this.points.material.uniforms.textureOffset.value = this.gpuCompute.getCurrentRenderTarget( this.offsetVar ).texture;
        this.points.material.uniforms.textureVelocity.value = this.gpuCompute.getCurrentRenderTarget( this.velocityVar ).texture;
        this.points.material.uniforms.textureColour.value = this.gpuCompute.getCurrentRenderTarget( this.colourVar ).texture;

        this.colourVar.material.uniforms.uTime.value = this.TIME;


        this.trails.forEach( trail => {

            trail.children.forEach( ( segment, i ) => {

                const uniforms = segment.material.uniforms;

                const getTextureIndex = index => ( this.gpuCompute.currentTextureIndex - index + this._maxTrailLength ) % ( this._maxTrailLength + 1 ) ;

                uniforms.textureCurPos.value = this.gpuCompute.getRenderTarget( this.offsetVar, getTextureIndex( i ) ).texture;
                uniforms.textureLastPos.value = this.gpuCompute.getRenderTarget( this.offsetVar, getTextureIndex( i + 1 ) ).texture;
                uniforms.textureCurColour.value = this.gpuCompute.getRenderTarget( this.colourVar, getTextureIndex( i ) ).texture;
                uniforms.textureLastColour.value = this.gpuCompute.getRenderTarget( this.colourVar, getTextureIndex( i + 1 ) ).texture;

            })

        });

    },

    dispose: function(){

        this.points.geometry.dispose();
        this.points.geometry = null;
        this.points.material.dispose();
        this.points.material = null;

	},

});

Object.defineProperties( THREE.ParticleSystem.prototype, {

    "vertexShader": {

        get: function(){ return this.VERTEX_SHADER },

        set: function( value ){

            this.VERTEX_SHADER = value;
            this.refreshMaterial();

        }

    },
    "sizeAttenuation": {

        get: function(){ return this.params.ATTEN_SIZE },

        set: function( value ){

            this.params.ATTEN_SIZE = value;
            this.refreshMaterial();

        }

    },

    "fragShader": {

        get: function(){ return this.FRAG_SHADER },

        set: function( value ){

            this.FRAG_SHADER = value;
            this.refreshMaterial();

        }

    },

    "maxParticles": {

        get: function(){ return this.params.MAX_PARTICLES },

        set: function( value ){

            console.warn( "New particle limit. Rebuilding system." );
            this.params.MAX_PARTICLES = value;
            this.init( true );

        }

    },
    "_softParticleLimit": {

        get: function(){

            let tmp = this.PARTICLE_LIMIT_REACHED ? this.params.MAX_PARTICLES : this.params.SPAWN_RATE * ( this.params.LIFETIME + this.params.VAR_LIFETIME );

            if( tmp > this.params.MAX_PARTICLES ){

                tmp = this.params.MAX_PARTICLES;
                console.warn( "Max number of Particles will be exceeded with current Spawn Rate and Lifetime! Capping to .maxParticles; increase to remove limit." );
                this.PARTICLE_LIMIT_REACHED = true;

            }

            if( this.params.ANIMATE_SPAWN ) tmp = this.params.MAX_PARTICLES;

            return tmp

        },

       set: function( value ){ console.warn( "This value is used internally, there is nothing to set. Perhaps you meant to set .maxParticles?" ) }

    },
    "spawnRate": {

        get: function(){ return this.params.SPAWN_RATE },

        set: function( value ){

            this.params.SPAWN_RATE = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ); };

        }

    },
    "animateSpawn": {

        get: function(){ return this.params.ANIMATE_SPAWN },

        set: function( value ){

            this.params.ANIMATE_SPAWN = value
            console.warn( "Modifying .animateSpawn dynamically requires a rebuild. Call .init( true ) to reinitialise Particle System." )

        }

    },

    "emitFrom": {

        get: function(){ return this.params.SPAWN_EMITFROM },

        set: function( value ){ this.params.SPAWN_EMITFROM = value; }

    },
    "elementDistribution": {

        get: function(){ return this.params.SPAWN_ELDISTRIB },

        set: function( value ){

            this.params.SPAWN_ELDISTRIB = value;

            if( this.params.SPAWN_ELDISTRIB > ( this.params.SPAWN_EMITFROM === "vert" ? this.parent.geometry.vertices.length : this.parent.geometry.faces.length ) - 1 ) this.emitIndex = 0;

        }

    },
    "emitIndex": {

        get: function(){ return this.params.SPAWN_INDEX },

        set: function( value ){ this.params.SPAWN_INDEX = value }

    },
    "emitDistribution": {

        get: function(){ return this.params.SPAWN_EMDISTRIB },

        set: function( value ){ this.params.SPAWN_EMDISTRIB = value }

    },
    "gridResolution": {

        get: function(){ console.log( "Not yet implemented" ) },//return this.params.GRID_RESOLUTION },

        set: function( value ){ this.params.GRID_RESOLUTION = value }

    },

    "size": {

        get: function(){ return this.params.SIZE },

        set: function( value ){

            this.params.SIZE = value * this.DPR;

        }

    },
    "varySize": {

        get: function(){ return this.params.VAR_SIZE },

        set: function( value ){

            this.params.VAR_SIZE = value;

        }

    },

    "lifetime": {

        get: function(){ return this.params.LIFETIME },

        set: function( value ){

            this.params.LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },
    "varyLifetime": {

        get: function(){ return this.params.VAR_LIFETIME },

        set: function( value ){

            this.params.VAR_LIFETIME = value;
            if( this.params.ANIMATE_SPAWN ){

                this.rateCounter = 0;
                this.PARTICLE_LIMIT_REACHED = false;

            } else{ this.init( true ) };

        }

    },

    "initPosition": {

        get: function(){ return this.params.INIT_POS },

        set: function( value ){

            this.params.INIT_POS = this.opt_FloatToVec( value );

        }

    },
    "varyPosition": {

        get: function(){ return this.params.VAR_POS },

        set: function( value ){

            this.params.VAR_POS = this.opt_FloatToVec( value );

        }

    },

    "normalVelocity": {

       get: function(){ return this.params.NORM_VEL },

       set: function( value ){ this.params.NORM_VEL = value }

    },
    "varyNormalVelocity": {

       get: function(){ return this.params.VAR_NORM_VEL },

       set: function( value ){ this.params.VAR_NORM_VEL = value }

    },
    "initVelocity": {

        get: function(){ return this.params.INIT_VEL },

        set: function( value ){

            this.params.INIT_VEL = this.opt_FloatToVec( value );

        }

    },
    "varyVelocity": {

        get: function(){ return this.params.VAR_VEL },

        set: function( value ){

            this.params.VAR_VEL = this.opt_FloatToVec( value );

        }

    },

    "initColour": {

        get: function(){ return this.params.INIT_COL },

        set: function( value ){

            this.params.INIT_COL = this.opt_FloatToVec( value );

        }

    },
    "varyColour": {

        get: function(){ return this.params.VAR_COL },

        set: function( value ){

            this.params.VAR_COL = this.opt_FloatToVec( value );

        }

    },

    "displayMode": {

        get: function(){ return this.params.DISPLAY_MODE },

        set: function( value ){

            this.params.DISPLAY_MODE = value;
            console.warn( "Modifying .displayMode dynamically requires a rebuild.")
            this.init( true );

        }

    },
    "instanceObject": {

        get: function(){ return this.params.INSTANCED },

        set: function( value ){

            this.params.INSTANCED = value;
            this.init( true );

        }

    },

    "enablePhysics": {

        get: function(){ return this.params.ENABLE_PHYSICS },

        set: function( value ){

            this.params.ENABLE_PHYSICS = value;
            this.initComputeRenderer();

        }

    },

})

THREE.ForceCarrier = function( pars, main, uniforms, showHelper ){

    THREE.Object3D.apply( this, arguments );

    this.type = "CustomForce";
    this.isForceCarrier = true;

    this.fragmentPars = pars;
    this.fragmentMain = main;
    this.uniforms = uniforms;

    showHelper && this.drawHelper();

};

THREE.ForceCarrier.prototype = Object.create( THREE.Object3D.prototype );
THREE.ForceCarrier.prototype.constructor = THREE.ForceCarrier;

Object.assign( THREE.ForceCarrier.prototype, {

    drawHelper: function(){

    },

});

THREE.ConstantForce = function( accel, showHelper ){

    THREE.Object3D.apply( this, arguments );

    this.type = "ConstantForce";
    this.isForceCarrier = true;
    this.acceleration = accel !== undefined ? accel : new THREE.Vector3( 0, -9.81, 0 );
    showHelper && this.drawHelper();

}

THREE.ConstantForce.prototype = Object.create( THREE.Object3D.prototype );
THREE.ConstantForce.prototype.constructor = THREE.ConstantForce;

Object.assign( THREE.ConstantForce.prototype, {

    drawHelper: function(){

        if( this.children.length > 0 ) this.remove( this.children[0] );

        const helperMesh = new THREE.Mesh( new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial( { wireframe : true } ) );
        helperMesh.up = new THREE.Vector3( 0, 0, 1 );
        helperMesh.add( new THREE.ArrowHelper( helperMesh.up, helperMesh.position, 1, 0xffffff ) );
        helperMesh.position.copy( this.position );
        helperMesh.lookAt( this.acceleration.clone().normalize() );
        this.add( helperMesh );

    },


})

THREE.PointForce = function( strength, decay, showHelper ){

    THREE.Object3D.apply( this, arguments );

    this.type = "PointForce";
    this.isForceCarrier = true;
    this.strength = strength !== undefined ? strength : 1;
    this.decay = decay !== undefined? decay : 2;
    showHelper && this.drawHelper();

}

THREE.PointForce.prototype = Object.create( THREE.Object3D.prototype );
THREE.PointForce.prototype.constructor = THREE.PointForce;

Object.assign( THREE.PointForce.prototype, {

    drawHelper: function(){

        const helperMesh = new THREE.Mesh( new THREE.SphereGeometry( 0.5, 6, 6 ), new THREE.MeshBasicMaterial( { wireframe : true } ) );

        [ 1, -1 ].forEach( dir => {

            [ new THREE.Vector3( -0.5, 1, 0 ), new THREE.Vector3( 0, 1.1, 0 ), new THREE.Vector3( 0.5, 1, 0 ) ].forEach( arrow => {

                const arrowOrigin = helperMesh.position.clone().add( arrow.multiplyScalar( dir ) );
                if( this.strength > 0 ){

                    helperMesh.add( new THREE.ArrowHelper( arrow.clone().normalize(), arrowOrigin.add( arrow.multiplyScalar( 0.5 ) ), 0.5, 0xffffff, 0.2, 0.2 ) );

                } else{

                    helperMesh.add( new THREE.ArrowHelper( arrow.negate().normalize(), arrowOrigin, 0.5, 0xffffff, 0.2, 0.2 ) );

                }

            });

        })

        helperMesh.position.copy( this.position );
        this.add( helperMesh );

    },


})



Object.assign( THREE.ShaderChunk, {

    gpup_shader_pars_vertex: "\nattribute vec2 reference;\nattribute float birthTime;\nattribute vec4 color;\nattribute float lifetime;\nattribute float size;\nuniform float uTime;\nuniform sampler2D textureOffset;\nuniform sampler2D textureVelocity;\nuniform sampler2D textureColour;\n",

    begin_vertex_modified: "\nfloat age = uTime - birthTime;\nvec3 finalPosition = position * size + texture2D( textureOffset, reference ).xyz;\nif( age < 0.0 || age > lifetime ) finalPosition = vec3( 0, 0, 0 );\nvec3 transformed = vec3( finalPosition );\n",

    morphtarget_vertex_modified: "#ifdef USE_MORPHTARGETS\n\ttransformed += ( morphTarget0 - finalPosition ) * morphTargetInfluences[ 0 ];\n\ttransformed += ( morphTarget1 - finalPosition ) * morphTargetInfluences[ 1 ];\n\ttransformed += ( morphTarget2 - finalPosition ) * morphTargetInfluences[ 2 ];\n\ttransformed += ( morphTarget3 - finalPosition ) * morphTargetInfluences[ 3 ];\n\t#ifndef USE_MORPHNORMALS\n\ttransformed += ( morphTarget4 - finalPosition ) * morphTargetInfluences[ 4 ];\n\ttransformed += ( morphTarget5 - finalPosition ) * morphTargetInfluences[ 5 ];\n\ttransformed += ( morphTarget6 - finalPosition ) * morphTargetInfluences[ 6 ];\n\ttransformed += ( morphTarget7 - finalPosition ) * morphTargetInfluences[ 7 ];\n\t#endif\n#endif\n",

    gpup_offset_frag: `
        uniform float delta;
        uniform sampler2D particleInfo;
        uniform sampler2D newPos;
        uniform sampler2D newVel;

        void main() {

            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec4 position = texture2D( textureOffset, uv );
            vec4 velocity = texture2D( textureVelocity, uv );

            vec3 particleInfo = texture2D( particleInfo, uv ).xyz;
            float isUpdated = particleInfo.x;

            if( isUpdated > 0.0 ){
                position = texture2D( newPos, uv );
                velocity = texture2D( newVel, uv );
            }

            gl_FragColor = vec4( position.xyz + velocity.xyz * delta, 1 );

        }
    `,

    gpup_velocity_frag: `\nuniform float delta;\nuniform sampler2D particleInfo; //[isUpdated,mass,charge]\nuniform sampler2D newPos;\nuniform sampler2D newVel;\n\n<<<PHYSICS_PARS_CHUNK>>>\n\nvoid main() {\n\n\tvec2 uv = gl_FragCoord.xy / resolution.xy;\n\tvec4 uVel = texture2D( textureVelocity, uv );\n\tvec4 position = texture2D( textureOffset, uv );\n\tvec3 resForce = vec3( 0, 0, 0 );\n\tvec3 r_forcefield;\n\n\tvec3 particleInfo = texture2D( particleInfo, uv ).xyz;\n\tfloat isUpdated = particleInfo.x;\n\tfloat mass = particleInfo.y;\n\tfloat charge = particleInfo.z;\n\n\tif( isUpdated > 0.0 ){\n\t\tuVel = texture2D( newVel, uv );\n\t\tposition = texture2D( newPos, uv );\n\t}\n\n\t<<<PHYSICS_MAIN_CHUNK>>>\n\n\tvec3 vVel = uVel.xyz + ( resForce / mass ) * delta;\n\tgl_FragColor = vec4( vVel, 1 );\n\n}\n`,

    gpup_colour_frag: `

    uniform sampler2D particleInfo;
    uniform sampler2D newCol;
    uniform float uTime;

    void main() {

        vec4 colour;

        vec2 uv = gl_FragCoord.xy / resolution.xy;

        vec3 particleInfo = texture2D( particleInfo, uv ).xyz;
        float isUpdated = particleInfo.x;

        colour = texture2D( textureColour, uv );

        if( isUpdated > 0.0 ){
            colour = texture2D( newCol, uv );
        }

        gl_FragColor = colour;
    }`,

    gpup_physics:{
        point_pars: `\nstruct sPointForceField {\n\tvec3 position;\n\tfloat strength;\n\tfloat decay;\n};\nuniform sPointForceField forcefields_point[ NUM_POINT_PHYS_ATTR ];\n`,

        point_main: `\nsPointForceField pointForceField;\n#pragma unroll_loop\n\tfor ( int i = 0; i < NUM_POINT_PHYS_ATTR; i ++ ) {\n\t\tpointForceField = forcefields_point[ i ];\n\t\tr_forcefield = position.xyz - pointForceField.position;\n\t\tresForce += normalize( r_forcefield ) * pointForceField.strength * mass / pow( length( r_forcefield ), pointForceField.decay );\n}\n`,

        const_pars: `\nstruct sConstantForceField {\n\tvec3 acceleration;};\nuniform sConstantForceField forcefields_const[ NUM_CONST_PHYS_ATTR ];\n`,

        const_main: `\nsConstantForceField constForceField;\n#pragma unroll_loop\n\tfor ( int i = 0; i < NUM_CONST_PHYS_ATTR; i ++ ) {\n\t\tconstForceField = forcefields_const[ i ];\n\t\tresForce += constForceField.acceleration / mass;\n\t}\n`,

        boid_pars: `\nuniform float view_radius;\nuniform float separation_threshold; //Radius it wants clear of others\nuniform float separation_strength; //Repulsion from others\nuniform float flock_threshold; //Radius it considers boids to be part of its 'flock'\nuniform float cohesion_strength; //Attraction to centre of flock\nuniform float alignment_strength; //Strength of speed matching between flock members\n`,

        boid_main: `\nvec3 boidsPerceivedCOM = vec3( 0, 0, 0 );\nvec3 boidsPerceivedVelocity = vec3( 0, 0, 0 );\nvec3 boidsSeparationVelocity = vec3( 0, 0, 0 );\nfloat numBoids = 0.0;\nvec3 maxBoidVel = vec3( 1.0, 1.0, 1.0 );\nfor( float y = 0.0; y < resolution.y; y++ ){\n\n\tfor( float x = 0.0; x < resolution.x; x++ ){\n\n\t\tvec2 boidRef = vec2( x + 0.5, y + 0.5 ) / resolution.xy; //Get other boid reference\n\n\t\tif( length( boidRef - uv ) < 0.001 ) continue; //If self, ignore\n\n\t\tvec3 boidPos = texture2D( textureOffset, boidRef ).xyz;\n\t\tvec3 boidVel = texture2D( textureVelocity, boidRef ).xyz;\n\n\t\tif( boidPos == vec3( 0, 0, 0 ) && boidVel == vec3( 0, 0, 0 ) ) continue; //If other boid is immobile at origin ( i.e. undrawn ), ignore\n\n\t\tvec3 boidDisplacement = boidPos - position.xyz;\n\t\tfloat boidDistance = length( boidDisplacement );\n\n\t\tfloat thresholdDistance = boidDistance / view_radius;\n\n\t\tif( thresholdDistance > 1.0 ) continue; //If out of view, ignore\n\n\t\tif( thresholdDistance < separation_threshold ) boidsSeparationVelocity -= normalize( boidDisplacement ) / boidDistance; //Neighbour too close\n\n\t\tif( thresholdDistance < flock_threshold ) { //Neighbour in flock\n\t\t\tnumBoids++;\n\t\t\tboidsPerceivedCOM += boidPos;\n\t\t\tboidsPerceivedVelocity += boidVel;\n\t\t}\n\n\t}\n\n}\n\n//Cohesion + Separation + Alignment\nresForce += mass * clamp( ( boidsPerceivedCOM / numBoids - position.xyz ) * cohesion_strength + boidsSeparationVelocity * separation_strength + ( boidsPerceivedVelocity / numBoids - uVel.xyz ) * alignment_strength, -maxBoidVel, maxBoidVel );\n`
    },

});


THREE.Geometry.prototype.computeVertexNormals_New = function ( areaWeighted ) {

		if ( areaWeighted === undefined ) areaWeighted = true;

		var v, vl, vA, vB, vC, f, fl, face, vertices, normal;

		vertices = new Array( this.vertices.length ).fill( 0 ).map( el => [] );

        this.faces.forEach( face => {

            if ( areaWeighted ) {

                // vertex normals weighted by triangle areas
                // http://www.iquilezles.org/www/articles/normals/normals.htm
                // cross-product of two adjacent regular polygon edges is directly proportional to polygon's area

    			var cb = new THREE.Vector3(), ab = new THREE.Vector3();

				vA = this.vertices[ face.a ];
				vB = this.vertices[ face.b ];
				vC = this.vertices[ face.c ];

				cb.subVectors( vC, vB );
				ab.subVectors( vA, vB );
				normal = cb.cross( ab );

		    } else {

    			this.computeFaceNormals();
                normal = face.normal;

            }

            //Test for planar duplicates (vectors pointing in same direction)
			!vertices[ face.a ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.a ].push( normal.clone() );
			!vertices[ face.b ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.b ].push( normal.clone() );
			!vertices[ face.c ].some( vec => JSON.stringify( vec ) === JSON.stringify( normal ) ) && vertices[ face.c ].push( normal.clone() );

		});

        vertices = vertices.map( arr => arr.reduce( ( acc, vec ) => acc.add( vec ), new THREE.Vector3() ).normalize() );

		for ( f = 0, fl = this.faces.length; f < fl; f ++ ) {

			face = this.faces[ f ];

			var vertexNormals = face.vertexNormals;

			if ( vertexNormals.length === 3 ) {

                vertexNormals[ 0 ].copy( vertices[ face.a ] );
				vertexNormals[ 1 ].copy( vertices[ face.b ] );
				vertexNormals[ 2 ].copy( vertices[ face.c ] );

			} else {

				vertexNormals[ 0 ] = vertices[ face.a ].clone();
				vertexNormals[ 1 ] = vertices[ face.b ].clone();
				vertexNormals[ 2 ] = vertices[ face.c ].clone();

			}

		}

		if ( this.faces.length > 0 ) {

			this.normalsNeedUpdate = true;

		}

	}
